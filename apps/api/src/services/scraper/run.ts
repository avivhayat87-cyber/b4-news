// A discovery run ("איתור כתבות"): every active source, only what was published
// since that source's last successful run (delta fetch), never an article twice.
import type { SelectorConfig } from '@b4/shared';
import {
  and,
  categories,
  eq,
  inArray,
  scrapedItemPayloads,
  scrapedItems,
  scrapeRunItems,
  scrapeRuns,
  scrapeRunSources,
  sources,
  sql,
} from '@b4/db';
import { AppError } from '../../errors';
import { enqueue } from '../../lib/jobs';
import { classifyHeadline } from '../classify';
import type { Services } from '../context';
import { type SourceSpec, canonicalUrl, categoryFor, completeItem, contentHash, listItems, sha256 } from './collect';

const BREAK_AFTER_FAILURES = 5;

export async function startRun(s: Services, staffId: string | null, trigger: 'manual' | 'schedule' = 'manual') {
  const [running] = await s.db
    .select({ id: scrapeRuns.id })
    .from(scrapeRuns)
    .where(inArray(scrapeRuns.status, ['queued', 'running']))
    .limit(1);
  if (running) return { runId: running.id, created: false };

  const [{ n } = { n: 0 }] = await s.db.select({ n: sql<number>`count(*)::int` }).from(sources).where(eq(sources.status, 'active'));
  if (n === 0) throw new AppError(409, 'no_sources', 'אין עדיין אתרים פעילים. הוסיפו אתר ב"הגדרות אתרים" וחכו לאישור המפתח.');

  const [run] = await s.db.insert(scrapeRuns).values({ trigger, triggeredBy: staffId, status: 'queued' }).returning({ id: scrapeRuns.id });
  await enqueue(s.db, 'discovery.run', { runId: run!.id }, { createdBy: staffId, maxAttempts: 1 });
  return { runId: run!.id, created: true };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

export async function runDiscovery(s: Services, runId: string): Promise<{ found: number; inserted: number }> {
  const { db } = s;
  await db.update(scrapeRuns).set({ status: 'running', startedAt: new Date() }).where(eq(scrapeRuns.id, runId));
  const categoryIds = new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]));
  const active = await db.select().from(sources).where(eq(sources.status, 'active'));

  let totalFound = 0;
  let totalNew = 0;
  let failedSources = 0;

  for (const source of active) {
    const started = Date.now();
    await db.insert(scrapeRunSources).values({ runId, sourceId: source.id, status: 'running', since: source.watermarkPublishedAt });
    try {
      if (!source.method || !source.selectorConfig) throw new Error('source is not configured');
      if (source.method === 'html_js') throw new Error('html_js sources are not supported yet');
      const spec: SourceSpec = { name: source.name, method: source.method, listUrls: source.listUrls, config: source.selectorConfig as SelectorConfig };
      const listed = await listItems(s.fetch, spec, source.watermarkPublishedAt);

      // Skip what we already have before opening any article page.
      const hashes = listed.map((i) => sha256(canonicalUrl(i.url)));
      const known = new Set(
        hashes.length
          ? (await db.select({ h: scrapedItems.urlHash }).from(scrapedItems).where(inArray(scrapedItems.urlHash, hashes))).map((r) => r.h)
          : [],
      );
      const fresh = listed.filter((_, i) => !known.has(hashes[i]!));
      let inserted = 0;
      let itemErrors = 0;

      await pool(fresh, 4, async (found) => {
        try {
          const item = await completeItem(s.fetch, spec, found);
          if (!item.title) return;
          const hash = contentHash(item.bodyText);
          if (hash) {
            const [dup] = await db.select({ id: scrapedItems.id }).from(scrapedItems).where(eq(scrapedItems.contentHash, hash)).limit(1);
            if (dup) return;
          }
          const slug = categoryFor(item.url, spec.config) ?? null;
          const categoryId =
            (slug ? categoryIds.get(slug) : undefined) ?? source.defaultCategoryId ?? categoryIds.get(classifyHeadline(`${item.title} ${item.intro ?? ''}`) ?? '') ?? null;
          const [row] = await db
            .insert(scrapedItems)
            .values({
              sourceId: source.id,
              firstRunId: runId,
              url: item.url,
              urlHash: item.urlHash,
              contentHash: hash,
              title: item.title.slice(0, 500),
              intro: item.intro?.slice(0, 2000) ?? null,
              bodyText: item.bodyText?.slice(0, 100_000) ?? null,
              imageUrl: item.imageUrl,
              publishedAt: item.publishedAt,
              categoryId,
            })
            .onConflictDoNothing({ target: scrapedItems.urlHash })
            .returning({ id: scrapedItems.id });
          if (!row) return;
          await db.insert(scrapedItemPayloads).values({ itemId: row.id, raw: item.raw });
          await db.insert(scrapeRunItems).values({ runId, itemId: row.id, origin: 'found' });
          inserted++;
        } catch (err) {
          itemErrors++;
          s.log.warn({ source: source.name, url: found.url, err: err instanceof Error ? err.message : err }, 'discovery item failed');
        }
      });

      const newest = listed.reduce<Date | null>((max, i) => (i.publishedAt && (!max || i.publishedAt > max) ? i.publishedAt : max), source.watermarkPublishedAt);
      await db
        .update(scrapeRunSources)
        .set({
          status: itemErrors && !inserted && fresh.length ? 'partial' : 'succeeded',
          newWatermark: newest,
          itemsFound: listed.length,
          itemsNew: inserted,
          error: itemErrors ? `${itemErrors} כתבות לא נקראו` : null,
          durationMs: Date.now() - started,
        })
        .where(and(eq(scrapeRunSources.runId, runId), eq(scrapeRunSources.sourceId, source.id)));
      await db
        .update(sources)
        .set({ watermarkPublishedAt: newest, lastSuccessAt: new Date(), consecutiveFailures: 0 })
        .where(eq(sources.id, source.id));
      totalFound += listed.length;
      totalNew += inserted;
    } catch (err) {
      failedSources++;
      const message = err instanceof Error ? err.message : String(err);
      s.log.warn({ source: source.name, err: message }, 'discovery source failed');
      await db
        .update(scrapeRunSources)
        .set({ status: 'failed', error: message.slice(0, 500), durationMs: Date.now() - started })
        .where(and(eq(scrapeRunSources.runId, runId), eq(scrapeRunSources.sourceId, source.id)));
      await db
        .update(sources)
        .set({
          consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
          status: sql`case when ${sources.consecutiveFailures} + 1 >= ${BREAK_AFTER_FAILURES} then 'broken'::source_status else ${sources.status} end`,
        })
        .where(eq(sources.id, source.id));
    }
  }

  const status = active.length === 0 || failedSources === active.length ? 'failed' : failedSources ? 'partial' : 'succeeded';
  await db.update(scrapeRuns).set({ status, finishedAt: new Date(), itemsFound: totalFound, itemsNew: totalNew }).where(eq(scrapeRuns.id, runId));
  return { found: totalFound, inserted: totalNew };
}

/** Marks a run failed if its job dies (e.g. the worker was stopped). */
export async function failRun(s: Services, runId: string, message: string) {
  await s.db.update(scrapeRuns).set({ status: 'failed', finishedAt: new Date() }).where(and(eq(scrapeRuns.id, runId), inArray(scrapeRuns.status, ['queued', 'running'])));
  s.log.error({ runId, message }, 'discovery run failed');
}
