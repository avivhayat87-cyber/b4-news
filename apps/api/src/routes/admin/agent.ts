// The newsroom agent: the chat in the CMS, the editor agent's settings and
// learning reports, the visual agent (Google), the fact check, and the tool
// endpoint the Claude app (MCP) calls with a personal access token.
import {
  AgentTeamDto,
  AgentUsageQuery,
  AgentUsageReportDto,
  SaveSkillInput,
  SkillDto,
  AgentConversationDto,
  AgentConversationSummary,
  AgentStatusDto,
  AgentToolDef,
  AgentToolResult,
  McpConfigDto,
  RunAgentToolInput,
  ApiTokenDto,
  CreateApiTokenInput,
  CreatedApiToken,
  DecideActionInput,
  EditorAgentSettings,
  FactCheckDto,
  LearningReportDto,
  ReviewerSettings,
  SaveVisualRulesInput,
  SendAgentMessageInput,
  SocialAgentOverview,
  SocialAgentSettings,
  VisualAgentOverview,
  VisualAgentSettings,
} from '@b4/shared';
import { fileURLToPath } from 'node:url';
import { and, desc, eq, isNull, staffApiTokens } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../errors';
import { audit } from '../../lib/audit';
import { newToken, sha256 } from '../../lib/crypto';
import { STAFF_TOKEN_PREFIX, requireStaff } from '../../plugins/auth';
import { agentStatus, conversationDto, decideAction, listConversations, sendMessage } from '../../services/agent/chat';
import { draftFacts, getEditorSettings, saveEditorSettings } from '../../services/agent/editor';
import { getReviewerSettings, saveReviewerSettings } from '../../services/agent/reviewer';
import { getSkill, restoreSkill, saveSkill } from '../../services/agent/skills';
import { saveSocialSettings, socialAgentOverview } from '../../services/agent/social';
import { agentTeam, agentUsage } from '../../services/agent/team';
import { runTool, toolsFor } from '../../services/agent/tools';
import { activateVisualProfile, getVisualSettings, queueVisualLearning, saveVisualRules, saveVisualSettings, visualOverview } from '../../services/agent/visual';
import type { Services } from '../../services/context';
import { learningReportsList } from '../../services/learning';

const idParam = z.object({ id: z.string().uuid() });
/** The stdio MCP server the Claude app starts (plain JS, no dependencies). */
const MCP_SCRIPT = fileURLToPath(new URL('../../../mcp/b4-news-mcp.mjs', import.meta.url));
const tokenDto = (t: typeof staffApiTokens.$inferSelect) => ({
  id: t.id,
  name: t.name,
  createdAt: t.createdAt.toISOString(),
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  revokedAt: t.revokedAt?.toISOString() ?? null,
});

export const agentRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  // --- Chat ------------------------------------------------------------------------------
  app.get('/agent/status', { schema: { response: { 200: AgentStatusDto } } }, async (req) => agentStatus(s, requireStaff(req)));

  app.get('/agent/conversations', { schema: { response: { 200: z.array(AgentConversationSummary) } } }, async (req) => listConversations(s, requireStaff(req)));

  app.get('/agent/conversations/:id', { schema: { params: idParam, response: { 200: AgentConversationDto } } }, async (req) => conversationDto(s, requireStaff(req), req.params.id));

  app.post(
    '/agent/messages',
    { schema: { body: SendAgentMessageInput, response: { 202: z.object({ conversationId: z.string().uuid() }) } }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => reply.status(202).send(await sendMessage(s, requireStaff(req), req.body)),
  );

  app.post('/agent/conversations/:id/decide', { schema: { params: idParam, body: DecideActionInput } }, async (req, reply) => {
    await decideAction(s, requireStaff(req), req.params.id, req.body.toolUseId, req.body.approve);
    return reply.status(204).send();
  });

  // --- The editor agent ------------------------------------------------------------------------
  app.get('/agent/editor-settings', { schema: { response: { 200: EditorAgentSettings } } }, async () => getEditorSettings(s.db));

  app.put('/agent/editor-settings', { schema: { body: EditorAgentSettings, response: { 200: EditorAgentSettings } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    const saved = await saveEditorSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'editor-settings', action: 'update' });
    return saved;
  });

  app.get('/agent/learning-reports', { schema: { response: { 200: z.array(LearningReportDto) } } }, async () => learningReportsList(s));

  // --- The agent team and their skills ("הגדרות" > "צוות הסוכנים") ---------------------------------
  app.get('/agents', { schema: { response: { 200: AgentTeamDto } } }, async () => agentTeam(s));

  app.get('/agents/usage', { schema: { querystring: AgentUsageQuery, response: { 200: AgentUsageReportDto } } }, async (req) => agentUsage(s, req.query));

  const skillParams = z.object({ key: z.string().regex(/^[a-z]+\.[a-z]+$/) });
  app.get('/skills/:key', { schema: { params: skillParams, response: { 200: SkillDto } } }, async (req) => getSkill(s.db, req.params.key));

  // A skill decides what every AI call of that agent does: only an admin changes one, and it is recorded.
  app.put('/skills/:key', { schema: { params: skillParams, body: SaveSkillInput, response: { 200: SkillDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const skill = await saveSkill(s.db, staff, req.params.key, req.body.body);
    await audit(s.db, { userId: staff.id, entity: 'skill', entityId: req.params.key, action: 'update', details: { version: skill.versions.find((v) => v.isActive)?.version } });
    return skill;
  });

  app.post(
    '/skills/:key/versions/:version/restore',
    { schema: { params: skillParams.extend({ version: z.coerce.number().int().positive() }), response: { 200: SkillDto } } },
    async (req) => {
      const staff = requireStaff(req, 'admin');
      const skill = await restoreSkill(s.db, staff, req.params.key, req.params.version);
      await audit(s.db, { userId: staff.id, entity: 'skill', entityId: req.params.key, action: 'restore', details: { from: req.params.version } });
      return skill;
    },
  );

  // --- The legal reviewer --------------------------------------------------------------------------
  app.get('/agent/reviewer-settings', { schema: { response: { 200: ReviewerSettings } } }, async () => getReviewerSettings(s.db));

  // Turning the review off lets risky articles through: only an admin, and it is recorded.
  app.put('/agent/reviewer-settings', { schema: { body: ReviewerSettings, response: { 200: ReviewerSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const saved = await saveReviewerSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'reviewer-settings', action: 'update', details: saved });
    return saved;
  });

  // --- The social editor (the distribution plan before publishing) ---------------------------------
  app.get('/agent/social', { schema: { response: { 200: SocialAgentOverview } } }, async () => socialAgentOverview(s.db));

  app.put('/agent/social-settings', { schema: { body: SocialAgentSettings, response: { 200: SocialAgentSettings } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    const saved = await saveSocialSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'social-settings', action: 'update' });
    return saved;
  });

  // --- The visual agent (Google) ------------------------------------------------------------------
  app.get('/agent/visual', { schema: { response: { 200: VisualAgentOverview } } }, async (req) => {
    requireStaff(req);
    return visualOverview(s);
  });

  app.get('/agent/visual-settings', { schema: { response: { 200: VisualAgentSettings } } }, async () => getVisualSettings(s.db));

  app.put('/agent/visual-settings', { schema: { body: VisualAgentSettings, response: { 200: VisualAgentSettings } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    const saved = await saveVisualSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'visual-settings', action: 'update' });
    return saved;
  });

  app.post('/agent/visual/learn', { schema: { response: { 202: z.object({ jobId: z.string().uuid().nullable() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send({ jobId: await queueVisualLearning(s, staff.id, true) });
  });

  app.put('/agent/visual/rules', { schema: { body: SaveVisualRulesInput } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await saveVisualRules(s, staff.id, req.body.rules);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'visual-rules', action: 'update' });
    return reply.status(204).send();
  });

  app.post('/agent/visual/profiles/:id/activate', { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await activateVisualProfile(s, staff.id, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: `visual-profile:${req.params.id}`, action: 'activate' });
    return reply.status(204).send();
  });

  app.get('/drafts/:id/facts', { schema: { params: idParam, response: { 200: FactCheckDto } } }, async (req) => draftFacts(s.db, req.params.id));

  // --- The Claude app (MCP) ---------------------------------------------------------------------
  app.get('/agent/tokens', { schema: { response: { 200: z.array(ApiTokenDto) } } }, async (req) => {
    const staff = requireStaff(req);
    const rows = await s.db.select().from(staffApiTokens).where(eq(staffApiTokens.userId, staff.id)).orderBy(desc(staffApiTokens.createdAt));
    return rows.map(tokenDto);
  });

  app.post('/agent/tokens', { schema: { body: CreateApiTokenInput, response: { 201: CreatedApiToken } } }, async (req, reply) => {
    const staff = requireStaff(req);
    const secret = `${STAFF_TOKEN_PREFIX}${newToken()}`;
    const [row] = await s.db.insert(staffApiTokens).values({ userId: staff.id, name: req.body.name, tokenHash: sha256(secret) }).returning();
    await audit(s.db, { userId: staff.id, entity: 'api_token', entityId: row!.id, action: 'create' });
    return reply.status(201).send({ token: tokenDto(row!), secret });
  });

  app.post('/agent/tokens/:id/revoke', { schema: { params: idParam } }, async (req, reply) => {
    const staff = requireStaff(req);
    const [row] = await s.db
      .update(staffApiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(staffApiTokens.id, req.params.id), eq(staffApiTokens.userId, staff.id), isNull(staffApiTokens.revokedAt)))
      .returning({ id: staffApiTokens.id });
    if (!row) throw errors.notFound('המפתח');
    await audit(s.db, { userId: staff.id, entity: 'api_token', entityId: row.id, action: 'revoke' });
    return reply.status(204).send();
  });

  /** What to paste into the Claude app's config (the token is added by the CMS after it is created). */
  app.get('/agent/mcp-config', { schema: { response: { 200: McpConfigDto } } }, async (req) => {
    requireStaff(req);
    return {
      command: process.execPath,
      args: [MCP_SCRIPT],
      env: { B4_API_URL: `${s.config.publicApiUrl}/api/v1` },
    };
  });

  /** The tools this person may use, with their input schemas (the MCP server lists these). */
  app.get('/agent/tools', { schema: { response: { 200: z.array(AgentToolDef) } } }, async (req) => {
    const staff = requireStaff(req);
    return toolsFor(staff).map((t) => ({ name: t.name, title: t.label({}), description: t.description, inputSchema: t.schema, write: t.write }));
  });

  /** Runs one tool. The Claude app asks the person before every call that changes something. */
  app.post(
    '/agent/tools/:name',
    {
      schema: { params: z.object({ name: z.string().regex(/^[a-z_]{2,60}$/) }), body: RunAgentToolInput, response: { 200: AgentToolResult } },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const staff = requireStaff(req);
      const r = await runTool(s, staff, req.params.name, req.body.input ?? {});
      if (r.ok && staff.apiTokenId) await audit(s.db, { userId: staff.id, entity: 'agent_tool', entityId: req.params.name, action: 'run_via_token' });
      return r.ok ? { ok: true as const, outcome: r.outcome, result: r.result } : { ok: false as const, error: r.error };
    },
  );
};
