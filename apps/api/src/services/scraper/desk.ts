// The discovery desk ("איתור כתבות") as the CMS reads it: the runs, a run's articles with the same
// story from several sites grouped together (free, by the words of the headlines) and the chief
// editor's picks (picks.ts), an article set apart from its group, and an article moved to the
// latest run.
import type { RunDetail, RunDto, RunItemDto, SourceRegion } from '@b4/shared';
import { type Db, type RunPicksRecord, and, asc, categories, desc, eq, inArray, scrapedItems, scrapeRunItems, scrapeRuns, scrapeRunSources, sources, sql, users } from '@b4/db';
import { AppError, errors } from '../../errors';
import { groupByTopic } from '../../lib/similarity';
import type { Services } from '../context';

export async function runsWithSources(db: Db, runIds: string[]): Promise<RunDto[]> {
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

export async function latestRunId(db: Db, region: SourceRegion): Promise<string | null> {
  const [row] = await db.select({ id: scrapeRuns.id }).from(scrapeRuns).where(eq(scrapeRuns.region, region)).orderBy(desc(scrapeRuns.createdAt)).limit(1);
  return row?.id ?? null;
}

export type DeskItem = Omit<RunItemDto, 'pick'>;

/**
 * A run's articles, each same-story group together: its lead first (the fullest report, the main
 * original when the group is written as one article), then the others. A foreign article is
 * matched by its Hebrew headline once it has one.
 */
export async function runItems(db: Db, runId: string): Promise<DeskItem[]> {
  const rows = await db
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
      separated: scrapeRunItems.separated,
      language: scrapedItems.language,
      titleHe: scrapedItems.titleHe,
      introHe: scrapedItems.introHe,
      bodyLength: sql<number>`coalesce(length(${scrapedItems.bodyText}), 0)::int`,
    })
    .from(scrapeRunItems)
    .innerJoin(scrapedItems, eq(scrapeRunItems.itemId, scrapedItems.id))
    .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
    .leftJoin(categories, eq(scrapedItems.categoryId, categories.id))
    .where(eq(scrapeRunItems.runId, runId))
    .orderBy(desc(scrapedItems.publishedAt), asc(scrapedItems.title))
    .limit(1000);
  const groups = groupByTopic(rows, { title: (r) => r.titleHe ?? r.title, at: (r) => r.publishedAt?.getTime() ?? 0, alone: (r) => r.separated });
  return groups.flatMap((g) => {
    const members = [...g].sort((a, b) => b.bodyLength - a.bodyLength);
    const storyId = members.length > 1 ? members[0]!.id : null;
    return members.map(({ bodyLength: _, sourceId, sourceName, publishedAt, ...i }) => ({
      ...i,
      publishedAt: publishedAt?.toISOString() ?? null,
      source: { id: sourceId, name: sourceName ?? new URL(i.url).hostname },
      storyId,
    }));
  });
}

/** What the CMS says about a run's picks: a raw provider error becomes a message the editor can act on. */
function picksState(record: RunPicksRecord | null): RunDetail['picks'] {
  if (!record) return { status: 'none', count: 0, error: null };
  let error: string | null = null;
  if (record.status === 'failed') {
    const raw = record.error ?? '';
    error = /[א-ת]/.test(raw) ? raw : /not connected|api key|401|403/i.test(raw) ? 'אין חיבור ל-Claude. בדקו את המפתח ב"הגדרות" > "חיבורים".' : 'ההמלצות לא הצליחו. אפשר לבקש אותן שוב.';
  }
  return { status: record.status, count: record.items.length, error };
}

export async function runDetail(s: Services, runId: string): Promise<RunDetail> {
  const [run] = await runsWithSources(s.db, [runId]);
  if (!run) throw errors.notFound('האיתור');
  const [{ picks } = { picks: null }] = await s.db.select({ picks: scrapeRuns.picks }).from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1);
  const picked = new Map((picks?.status === 'ready' ? picks.items : []).map((p) => [p.itemId, { score: p.score, reason: p.reason }]));
  return {
    run,
    isLatest: (await latestRunId(s.db, run.region)) === runId,
    picks: picksState(picks),
    items: (await runItems(s.db, runId)).map((i) => ({ ...i, pick: picked.get(i.id) ?? null })),
  };
}

/** The editor takes an article out of its same-story group (or puts it back): it stays so in this run. */
export async function setSeparated(s: Services, runId: string, itemId: string, separated: boolean): Promise<RunDetail> {
  const [row] = await s.db
    .update(scrapeRunItems)
    .set({ separated })
    .where(and(eq(scrapeRunItems.runId, runId), eq(scrapeRunItems.itemId, itemId)))
    .returning({ itemId: scrapeRunItems.itemId });
  if (!row) throw errors.notFound('הכתבה');
  return runDetail(s, runId);
}

/** "Move to the latest run": the item shows up there too, marked as pulled. */
export async function pullToLatest(s: Services, itemId: string): Promise<{ runId: string }> {
  const [item] = await s.db.select({ id: scrapedItems.id, region: sources.region }).from(scrapedItems).leftJoin(sources, eq(scrapedItems.sourceId, sources.id)).where(eq(scrapedItems.id, itemId)).limit(1);
  if (!item) throw errors.notFound('הכתבה');
  // An article goes to the latest run of its own kind (Israeli or international).
  const latest = await latestRunId(s.db, item.region ?? 'local');
  if (!latest) throw new AppError(409, 'no_run', 'עוד לא היה איתור.');
  await s.db.insert(scrapeRunItems).values({ runId: latest, itemId: item.id, origin: 'pulled' }).onConflictDoNothing();
  // A pulled item that was set aside becomes selectable again.
  await s.db.update(scrapedItems).set({ status: 'new' }).where(and(eq(scrapedItems.id, item.id), eq(scrapedItems.status, 'ignored')));
  return { runId: latest };
}
