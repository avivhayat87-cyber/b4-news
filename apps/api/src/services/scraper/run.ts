// A discovery run ("איתור כתבות"): every active source of one region (Israeli or
// international), only what was published since that source's last successful
// run (delta fetch), never an article twice. Foreign articles are marked with
// their language and get Hebrew headlines right after the run; then the chief
// editor picks what to take first (picks.ts).
import type { SelectorConfig, SourceRegion } from '@b4/shared';
import {
  and,
  categories,
  eq,
  inArray,
  jobs,
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
import { classifyHeadline, outsideEconomy } from '../classify';
import type { Services } from '../context';
import { detectLanguage, queueHeadlineTranslation } from '../translate';
import { type SourceSpec, canonicalUrl, categoryFor, completeItem, contentHash, listItems, sha256 } from './collect';
import { queuePicks } from './picks';
import { RobotsCache } from './robots';

const BREAK_AFTER_FAILURES = 5;

/** Israeli and international sites are scanned by separate runs; one run per region at a time. */
export async function startRun(s: Services, staffId: string | null, trigger: 'manual' | 'schedule' = 'manual', region: SourceRegion = 'local') {
  const [running] = await s.db
    .select({ id: scrapeRuns.id })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.region, region), inArray(scrapeRuns.status, ['queued', 'running'])))
    .limit(1);
  if (running) {
    // A run whose job is gone (the process stopped mid-run) would block scanning for good: close it and start afresh.
    const [alive] = await s.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, 'discovery.run'), sql`${jobs.payload}->>'runId' = ${running.id}`, inArray(jobs.status, ['queued', 'running'])))
      .limit(1);
    if (alive) return { runId: running.id, created: false };
    await failRun(s, running.id, 'the scan stopped before it finished');
  }

  const [{ n } = { n: 0 }] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(sources)
    .where(and(eq(sources.status, 'active'), eq(sources.region, region)));
  if (n === 0) {
    throw new AppError(
      409,
      'no_sources',
      region === 'international'
        ? 'אין עדיין אתרים פעילים מחו״ל. הוסיפו אתרים ב"הגדרות אתרים" ← "אתרים מחו״ל" ואשרו אותם.'
        : 'אין עדיין אתרים פעילים. הוסיפו אתר ב"הגדרות אתרים" וחכו לאישור המפתח.',
    );
  }

  const [run] = await s.db.insert(scrapeRuns).values({ trigger, region, triggeredBy: staffId, status: 'queued' }).returning({ id: scrapeRuns.id });
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
  const [run] = await db.update(scrapeRuns).set({ status: 'running', startedAt: new Date() }).where(eq(scrapeRuns.id, runId)).returning({ region: scrapeRuns.region, triggeredBy: scrapeRuns.triggeredBy });
  const categoryIds = new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]));
  const active = await db
    .select()
    .from(sources)
    .where(and(eq(sources.status, 'active'), eq(sources.region, run?.region ?? 'local')));
  const foreign: string[] = [];
  const robots = new RobotsCache(s.fetch, s.config.scraper.userAgent);

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
          const item = await completeItem(s.fetch, spec, found, robots);
          if (!item.title) return;
          const hash = contentHash(item.bodyText);
          if (hash) {
            const [dup] = await db.select({ id: scrapedItems.id }).from(scrapedItems).where(eq(scrapedItems.contentHash, hash)).limit(1);
            if (dup) return;
          }
          // A site rule, then the site's default section, then a keyword guess. Items from non-economic
          // sections (politics, sport…) and items nothing places stay without one: "פוליטיקה ושונות".
          const slug = categoryFor(item.url, spec.config) ?? null;
          const guess = outsideEconomy(item.url) ? null : classifyHeadline(`${item.title} ${item.intro ?? ''}`);
          const categoryId = (slug ? categoryIds.get(slug) : undefined) ?? source.defaultCategoryId ?? categoryIds.get(guess ?? '') ?? null;
          const language = detectLanguage(`${item.title} ${item.intro ?? ''} ${(item.bodyText ?? '').slice(0, 2000)}`, source.language);
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
              language,
            })
            .onConflictDoNothing({ target: scrapedItems.urlHash })
            .returning({ id: scrapedItems.id });
          if (!row) return;
          if (language) foreign.push(row.id);
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
  // Foreign articles get Hebrew headlines in the background; the results show them as they arrive.
  await queueHeadlineTranslation(s, foreign, run?.triggeredBy ?? null);
  // Then the chief editor recommends what to take first (a failure there never fails the run).
  if (totalNew > 0) {
    await queuePicks(s, runId, run?.triggeredBy ?? null).catch((e: unknown) => s.log.warn({ runId, err: e instanceof Error ? e.message : e }, 'queueing the picks failed'));
  }
  return { found: totalFound, inserted: totalNew };
}

/**
 * Closes a run whose job died (e.g. the worker was stopped): the sites it had finished keep
 * their articles (status "partial"), the one it was in the middle of is marked failed.
 */
export async function failRun(s: Services, runId: string, message: string) {
  await s.db
    .update(scrapeRunSources)
    .set({ status: 'failed', error: message.slice(0, 500) })
    .where(and(eq(scrapeRunSources.runId, runId), eq(scrapeRunSources.status, 'running')));
  const done = await s.db
    .select({ found: scrapeRunSources.itemsFound, inserted: scrapeRunSources.itemsNew })
    .from(scrapeRunSources)
    .where(and(eq(scrapeRunSources.runId, runId), eq(scrapeRunSources.status, 'succeeded')));
  await s.db
    .update(scrapeRuns)
    .set({
      status: done.length ? 'partial' : 'failed',
      finishedAt: new Date(),
      itemsFound: done.reduce((n, d) => n + d.found, 0),
      itemsNew: done.reduce((n, d) => n + d.inserted, 0),
    })
    .where(and(eq(scrapeRuns.id, runId), inArray(scrapeRuns.status, ['queued', 'running'])));
  s.log.error({ runId, message }, 'discovery run failed');
}
