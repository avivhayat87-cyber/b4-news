// Discovery ("איתור כתבות"): start a run, browse current and past runs, pull an
// item from an old run into the latest one, save a selection as a magazine.
import { RunDetail, RunDto, SOURCE_REGIONS, SaveSelectionInput, SaveSelectionResult, type SourceRegion } from '@b4/shared';
import { type Db, and, asc, categories, desc, eq, inArray, scrapedItems, scrapeRunItems, scrapeRuns, scrapeRunSources, sources, users } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../../errors';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { createDraftsFromItems } from '../../services/drafts';
import { startRun } from '../../services/scraper/run';

async function runsWithSources(db: Db, runIds: string[]): Promise<RunDto[]> {
  if (runIds.length === 0) return [];
  const runs = await db
    .select({ run: scrapeRuns, by: users.fullName })
    .from(scrapeRuns)
    .leftJoin(users, eq(scrapeRuns.triggeredBy, users.id))
    .where(inArray(scrapeRuns.id, runIds))
    .orderBy(desc(scrapeRuns.createdAt));
  const perSource = await db
    .select({ runId: scrapeRunSources.runId, id: sources.id, name: sources.name, status: scrapeRunSources.status, itemsFound: scrapeRunSources.itemsFound, itemsNew: scrapeRunSources.itemsNew, error: scrapeRunSources.error })
    .from(scrapeRunSources)
    .innerJoin(sources, eq(scrapeRunSources.sourceId, sources.id))
    .where(inArray(scrapeRunSources.runId, runIds))
    .orderBy(asc(sources.name));
  return runs.map(({ run, by }) => ({
    id: run.id,
    trigger: run.trigger,
    region: run.region,
    status: run.status,
    triggeredBy: by,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    itemsFound: run.itemsFound,
    itemsNew: run.itemsNew,
    createdAt: run.createdAt.toISOString(),
    sources: perSource.filter((p) => p.runId === run.id).map(({ runId: _, ...p }) => p),
  }));
}

async function latestRunId(db: Db, region: SourceRegion): Promise<string | null> {
  const [row] = await db.select({ id: scrapeRuns.id }).from(scrapeRuns).where(eq(scrapeRuns.region, region)).orderBy(desc(scrapeRuns.createdAt)).limit(1);
  return row?.id ?? null;
}

const regionQuery = z.object({ region: z.enum(SOURCE_REGIONS).default('local') });

async function runDetail(s: Services, runId: string): Promise<RunDetail> {
  const [run] = await runsWithSources(s.db, [runId]);
  if (!run) throw errors.notFound('האיתור');
  const items = await s.db
    .select({
      id: scrapedItems.id,
      url: scrapedItems.url,
      title: scrapedItems.title,
      intro: scrapedItems.intro,
      imageUrl: scrapedItems.imageUrl,
      publishedAt: scrapedItems.publishedAt,
      sourceId: sources.id,
      sourceName: sources.name,
      category: categories.slug,
      status: scrapedItems.status,
      origin: scrapeRunItems.origin,
      language: scrapedItems.language,
      titleHe: scrapedItems.titleHe,
      introHe: scrapedItems.introHe,
    })
    .from(scrapeRunItems)
    .innerJoin(scrapedItems, eq(scrapeRunItems.itemId, scrapedItems.id))
    .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
    .leftJoin(categories, eq(scrapedItems.categoryId, categories.id))
    .where(eq(scrapeRunItems.runId, runId))
    .orderBy(desc(scrapedItems.publishedAt), asc(scrapedItems.title))
    .limit(1000);
  return {
    run,
    isLatest: (await latestRunId(s.db, run.region)) === runId,
    items: items.map((i) => ({
      id: i.id,
      url: i.url,
      title: i.title,
      intro: i.intro,
      imageUrl: i.imageUrl,
      publishedAt: i.publishedAt?.toISOString() ?? null,
      source: { id: i.sourceId, name: i.sourceName ?? new URL(i.url).hostname },
      category: i.category,
      status: i.status,
      origin: i.origin,
      language: i.language,
      titleHe: i.titleHe,
      introHe: i.introHe,
    })),
  };
}

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

  app.get('/discovery/runs/:id', { schema: { params: z.object({ id: z.string().uuid() }), response: { 200: RunDetail } } }, async (req) => runDetail(s, req.params.id));

  /** "Move to the latest run": the item shows up there too, marked as pulled. */
  app.post('/discovery/items/:id/pull', { schema: { params: z.object({ id: z.string().uuid() }), response: { 200: z.object({ runId: z.string().uuid() }) } } }, async (req) => {
    requireStaff(req, 'editor');
    const [item] = await s.db
      .select({ id: scrapedItems.id, region: sources.region })
      .from(scrapedItems)
      .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
      .where(eq(scrapedItems.id, req.params.id))
      .limit(1);
    if (!item) throw errors.notFound('הכתבה');
    // An article goes to the latest run of its own kind (Israeli or international).
    const latest = await latestRunId(s.db, item.region ?? 'local');
    if (!latest) throw new AppError(409, 'no_run', 'עוד לא היה איתור.');
    await s.db.insert(scrapeRunItems).values({ runId: latest, itemId: item.id, origin: 'pulled' }).onConflictDoNothing();
    // A pulled item that was set aside becomes selectable again.
    await s.db.update(scrapedItems).set({ status: 'new' }).where(and(eq(scrapedItems.id, item.id), eq(scrapedItems.status, 'ignored')));
    return { runId: latest };
  });

  app.post('/discovery/save', { schema: { body: SaveSelectionInput, response: { 201: SaveSelectionResult } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(201).send(await createDraftsFromItems(s, staff, req.body));
  });
};
