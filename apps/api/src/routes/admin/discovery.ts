// Discovery ("איתור כתבות"): start a run, browse current and past runs (same-story articles grouped,
// the chief editor's picks), set an article apart from its group, pull an item from an old run into
// the latest one, save a selection as a magazine or single articles.
import { DiscoveryPickSettings, RunDetail, RunDto, SOURCE_REGIONS, SaveSelectionInput, SaveSelectionResult, SeparateItemInput } from '@b4/shared';
import { eq, desc, scrapeRuns } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { createDraftsFromItems } from '../../services/drafts';
import { latestRunId, pullToLatest, runDetail, runsWithSources, setSeparated } from '../../services/scraper/desk';
import { getPickSettings, queuePicks, savePickSettings } from '../../services/scraper/picks';
import { startRun } from '../../services/scraper/run';

const regionQuery = z.object({ region: z.enum(SOURCE_REGIONS).default('local') });
const runParams = z.object({ id: z.string().uuid() });

export const discoveryRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.post('/discovery/runs', { schema: { body: regionQuery, response: { 202: z.object({ runId: z.string().uuid(), created: z.boolean() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send(await startRun(s, staff.id, 'manual', req.body.region));
  });

  app.get(
    '/discovery/runs',
    { schema: { querystring: regionQuery.extend({ limit: z.coerce.number().int().min(1).max(100).default(30) }), response: { 200: z.array(RunDto) } } },
    async (req) => {
      const ids = await s.db.select({ id: scrapeRuns.id }).from(scrapeRuns).where(eq(scrapeRuns.region, req.query.region)).orderBy(desc(scrapeRuns.createdAt)).limit(req.query.limit);
      return runsWithSources(s.db, ids.map((r) => r.id));
    },
  );

  app.get('/discovery/runs/latest', { schema: { querystring: regionQuery, response: { 200: RunDetail.nullable() } } }, async (req) => {
    const id = await latestRunId(s.db, req.query.region);
    return id ? runDetail(s, id) : null;
  });

  app.get('/discovery/runs/:id', { schema: { params: runParams, response: { 200: RunDetail } } }, async (req) => runDetail(s, req.params.id));

  /** The chief editor's picks for a run, again (or for a run from before picks existed). */
  app.post('/discovery/runs/:id/picks', { schema: { params: runParams, response: { 202: RunDetail } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    await queuePicks(s, req.params.id, staff.id, { force: true });
    return reply.status(202).send(await runDetail(s, req.params.id));
  });

  /** "Separate": the article stands alone in this run (separated false puts it back in its group). */
  app.post(
    '/discovery/runs/:id/items/:itemId/separate',
    { schema: { params: runParams.extend({ itemId: z.string().uuid() }), body: SeparateItemInput, response: { 200: RunDetail } } },
    async (req) => {
      requireStaff(req, 'editor');
      return setSeparated(s, req.params.id, req.params.itemId, req.body.separated);
    },
  );

  /** "Move to the latest run": the item shows up there too, marked as pulled. */
  app.post('/discovery/items/:id/pull', { schema: { params: runParams, response: { 200: z.object({ runId: z.string().uuid() }) } } }, async (req) => {
    requireStaff(req, 'editor');
    return pullToLatest(s, req.params.id);
  });

  app.post('/discovery/save', { schema: { body: SaveSelectionInput, response: { 201: SaveSelectionResult } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(201).send(await createDraftsFromItems(s, staff, req.body));
  });

  // The chief editor's picks after every run: how many, and which sections are leisure (an admin's call).
  app.get('/agent/pick-settings', { schema: { response: { 200: DiscoveryPickSettings } } }, async () => getPickSettings(s.db));

  app.put('/agent/pick-settings', { schema: { body: DiscoveryPickSettings, response: { 200: DiscoveryPickSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const saved = await savePickSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'pick-settings', action: 'update', details: saved });
    return saved;
  });
};
