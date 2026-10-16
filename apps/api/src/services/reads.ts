// Reads: the newsroom's own count of who reads what, per Israel day, article and kind of arrival
// (the site sorts its referrer into a few kinds; the app says it is the app). Only numbers are
// kept: no reader, address, device or cookie. Visits to the whole site (pages, countries,
// devices) are Cloudflare Web Analytics' job, switched on with a token in the site settings.
import { READ_SOURCES, type ReadSource, type ReadsOverview } from '@b4/shared';
import { and, articleReads, articles, desc, eq, gte, inArray, sql } from '@b4/db';
import { isLive } from '../lib/cards';
import { israelDay } from './agent/team';
import type { Services } from './context';

const TOP = 5;

/** Adds one read to today's count. An article that is not on the site is ignored, never an error. */
export async function recordRead(s: Services, articleId: number, from: ReadSource, at = new Date()): Promise<void> {
  const [live] = await s.db.select({ id: articles.id }).from(articles).where(and(eq(articles.id, articleId), isLive)).limit(1);
  if (!live) return;
  await s.db
    .insert(articleReads)
    .values({ day: israelDay(at), articleId, source: from, reads: 1 })
    .onConflictDoUpdate({ target: [articleReads.day, articleReads.articleId, articleReads.source], set: { reads: sql`${articleReads.reads} + 1` } });
}

/** The dashboard's numbers: today so far, the last 7 days, where today's reads came from, and today's most read. */
export async function readsOverview(s: Services, now = new Date()): Promise<ReadsOverview> {
  const days = Array.from({ length: 7 }, (_, i) => israelDay(new Date(now.getTime() - (6 - i) * 86_400_000)));
  const today = days[6]!;
  const total = sql<number>`sum(${articleReads.reads})::int`;

  const [perDay, perSource, top] = await Promise.all([
    s.db.select({ day: articleReads.day, reads: total }).from(articleReads).where(inArray(articleReads.day, days)).groupBy(articleReads.day),
    s.db.select({ source: articleReads.source, reads: total }).from(articleReads).where(eq(articleReads.day, today)).groupBy(articleReads.source),
    s.db
      .select({ id: articles.id, slug: articles.slug, title: articles.title, reads: total })
      .from(articleReads)
      .innerJoin(articles, eq(articleReads.articleId, articles.id))
      .where(and(eq(articleReads.day, today), gte(articleReads.reads, 1)))
      .groupBy(articles.id, articles.slug, articles.title)
      .orderBy(desc(total))
      .limit(TOP),
  ]);

  const byDay = new Map(perDay.map((r) => [r.day, r.reads]));
  const week = days.map((day) => ({ day, reads: byDay.get(day) ?? 0 }));
  const from = Object.fromEntries(READ_SOURCES.map((k) => [k, perSource.find((r) => r.source === k)?.reads ?? 0])) as ReadsOverview['from'];
  return { today: week[6]!.reads, yesterday: week[5]!.reads, week, from, top };
}
