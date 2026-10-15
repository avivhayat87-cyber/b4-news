// The newsroom agent: reads run at once, changes wait for the editor's approval,
// roles are respected, and the Claude app's tokens reach only the tools.
import { existsSync } from 'node:fs';
import { agentConversations, aiJobs, eq, scrapeRuns } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let viewer: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  await ctx.seedSources();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
});
afterAll(() => ctx.close());

async function chat(client: ReturnType<typeof staffClient>, text: string, conversationId?: string) {
  const sent = await client.post('/agent/messages', { text, conversationId });
  expect(sent.status).toBe(202);
  await ctx.drain();
  return (await client.get(`/agent/conversations/${sent.body.conversationId}`)).body;
}

describe('newsroom agent', () => {
  it('lists the tools each role may use', async () => {
    const forEditor = (await editor.get('/agent/status')).body;
    expect(forEditor.live).toBe(false); // no key in tests: the stand-in answers
    expect(forEditor.tools.some((t: { name: string; write: boolean }) => t.name === 'start_discovery' && t.write)).toBe(true);
    const forViewer = (await viewer.get('/agent/status')).body;
    expect(forViewer.tools.every((t: { write: boolean }) => !t.write)).toBe(true);
  });

  it('answers a question with a read tool, without asking', async () => {
    const conv = await chat(editor, 'מה המצב במערכת?');
    expect(conv.status).toBe('idle');
    const kinds = conv.messages.map((m: { kind: string }) => m.kind);
    expect(kinds).toEqual(['user', 'action', 'assistant']);
    expect(conv.messages[1].action).toMatchObject({ tool: 'newsroom_overview', write: false, status: 'done' });
    expect(conv.messages[2].text).toContain('articlesNotYetOnSocial');
    // Every model call is recorded with the other AI calls (cost, latency, prompt version).
    const calls = await ctx.db.select().from(aiJobs).where(eq(aiJobs.type, 'agent_turn'));
    expect(calls.map((c) => [c.status, c.promptKey])).toEqual([
      ['succeeded', 'agent.system'],
      ['succeeded', 'agent.system'],
    ]);
  });

  it('waits for approval before a change, and runs it only when approved', async () => {
    const conv = await chat(editor, 'תתחיל איתור כתבות');
    expect(conv.status).toBe('awaiting_approval');
    const action = conv.messages.at(-1).action;
    expect(action).toMatchObject({ tool: 'start_discovery', write: true, status: 'pending', label: 'התחלת איתור כתבות מישראל' });
    expect(await ctx.db.select().from(scrapeRuns)).toHaveLength(0); // nothing ran yet
    // While it waits, a new message is refused.
    expect((await editor.post('/agent/messages', { text: 'עוד משהו', conversationId: conv.id })).status).toBe(409);

    expect((await editor.post(`/agent/conversations/${conv.id}/decide`, { toolUseId: action.toolUseId, approve: true })).status).toBe(204);
    await ctx.drain();
    expect(await ctx.db.select().from(scrapeRuns)).toHaveLength(1);
    const after = (await editor.get(`/agent/conversations/${conv.id}`)).body;
    expect(after.status).toBe('idle');
    expect(after.messages.find((m: { action: { toolUseId: string } | null }) => m.action?.toolUseId === action.toolUseId).action).toMatchObject({ status: 'done', outcome: expect.stringContaining('האיתור') });
    expect(after.messages.at(-1).kind).toBe('assistant'); // the turn continued after the approval
    // Deciding again does nothing.
    expect((await editor.post(`/agent/conversations/${conv.id}/decide`, { toolUseId: action.toolUseId, approve: true })).status).toBe(409);
  });

  it('does not run a declined change', async () => {
    const conv = await chat(editor, 'תעשה איתור מחו״ל');
    const action = conv.messages.at(-1).action;
    expect(action).toMatchObject({ tool: 'start_discovery', input: { region: 'international' } });
    await editor.post(`/agent/conversations/${conv.id}/decide`, { toolUseId: action.toolUseId, approve: false });
    await ctx.drain();
    expect(await ctx.db.select().from(scrapeRuns).where(eq(scrapeRuns.region, 'international'))).toHaveLength(0);
    const after = (await editor.get(`/agent/conversations/${conv.id}`)).body;
    expect(after.status).toBe('idle');
    expect(after.messages.find((m: { action: { toolUseId: string } | null }) => m.action?.toolUseId === action.toolUseId).action.status).toBe('declined');
  });

  it('keeps conversations private and lets viewers chat with read tools only', async () => {
    const mine = (await editor.get('/agent/conversations')).body;
    expect(mine.length).toBe(3);
    expect((await viewer.get(`/agent/conversations/${mine[0].id}`)).status).toBe(404);
    const conv = await chat(viewer, 'תתחיל איתור');
    // The stand-in tries a change; for a viewer it is refused, not offered for approval.
    expect(conv.status).toBe('idle');
    expect(conv.messages[1].action).toMatchObject({ tool: 'start_discovery', status: 'failed' });
    const [stored] = await ctx.db.select().from(agentConversations).where(eq(agentConversations.id, conv.id));
    expect((stored!.history as unknown[]).length).toBe(4); // user, assistant(tool_use), user(tool_result), assistant
  });

  it('gives the Claude app a personal token that reaches only the tools', async () => {
    const created = await editor.post('/agent/tokens', { name: 'Claude Desktop' });
    expect(created.status).toBe(201);
    const bearer = { authorization: `Bearer ${created.body.secret}` };
    const tools = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/agent/tools', headers: bearer });
    expect(tools.statusCode).toBe(200);
    expect(JSON.parse(tools.body).some((t: { name: string }) => t.name === 'latest_discovery')).toBe(true);
    const run = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/agent/tools/list_sources', headers: bearer, payload: { input: { region: 'local' } } });
    expect(JSON.parse(run.body)).toMatchObject({ ok: true });
    // Not the rest of the API.
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/sources', headers: bearer })).statusCode).toBe(403);
    expect((await editor.post(`/agent/tokens/${created.body.token.id}/revoke`, {})).status).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/agent/tools', headers: bearer })).statusCode).toBe(401);
  });

  it('gives the Claude app a config that a release or a Node update does not break', async () => {
    const config = (await editor.get('/agent/mcp-config')).body;
    // Node from the PATH, not this process's own (versioned) folder; the script from MCP_SCRIPT.
    expect(config).toEqual({ command: 'node', args: [ctx.config.mcpScript], env: { B4_API_URL: 'http://api.test/api/v1' } });
    expect(existsSync(config.args[0])).toBe(true);
  });

  it('stores the editor agent settings', async () => {
    const saved = await editor.put('/agent/editor-settings', { divergence: 'strong', length: 'shorter', tone: 'עניני', instructions: '' });
    expect(saved.status).toBe(200);
    expect((await editor.get('/agent/editor-settings')).body).toMatchObject({ divergence: 'strong', length: 'shorter' });
    expect((await viewer.put('/agent/editor-settings', { divergence: 'light' })).status).toBe(403);
  });
});
