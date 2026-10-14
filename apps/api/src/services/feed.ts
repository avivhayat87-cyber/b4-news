// "הפיד שלי" for signed-in readers: articles in their topics ("העיתון שלי"), each with the
// conversation around it (the editors' pick or the most liked comment, and how many comments).
//   new      the latest first
//   popular  the week's most talked-about (comments count double a like)
//   for-you  fresh and talked-about together, with a light shuffle per visit (the seed), so
//            the feed changes from visit to visit but pages stay steady within one
// An article nobody commented on yet shows as an invitation to be the first.
import type { FeedMode, FeedPage } from '@b4/shared';
import { type Db, and, articles, categories, comments, desc, eq, inArray, isNull, readers, sql } from '@b4/db';
import type { Config } from '../config';
import { cardsQuery, decodeCursor, encodeCursor, isLive, olderThan, toCard } from '../lib/cards';

const PAGE = 12;
type CardRow = Awaited<ReturnType<typeof cardsQuery>>[number];

/** A small, repeatable pseudo-random number per (seed, article): the same order on every page of a visit. */
const jitter = (seed: number, id: number) => {
  const x = Math.sin(seed * 9301 + id * 49297) * 233280;
  return x - Math.floor(x); // 0..1
};

export async function readerSections(db: Db, readerId: string): Promise<string[]> {
  const [r] = await db.select({ digest: readers.digest }).from(readers).where(eq(readers.id, readerId)).limit(1);
  return r?.digest?.sections ?? [];
}

export async function feed(db: Db, config: Pick<Config, 'mediaBaseUrl'>, readerId: string, mode: FeedMode, cursor: string | undefined, seed: number): Promise<FeedPage> {
  const sections = await readerSections(db, readerId);
  const inSections = sections.length ? inArray(categories.slug, sections) : undefined;
  const engagement = sql<number>`(select count(*)::int * 2 + coalesce(sum(${comments.likeCount}), 0)::int from ${comments} where ${comments.articleId} = ${articles.id} and ${comments.status} = 'visible')`;

  let rows: CardRow[];
  let next: string | null = null;
  if (mode === 'new') {
    rows = await cardsQuery(db)
      .where(and(isLive, inSections, olderThan(decodeCursor(cursor))))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(PAGE + 1);
    if (rows.length > PAGE) next = encodeCursor({ publishedAt: rows[PAGE - 1]!.publishedAt.toISOString(), id: rows[PAGE - 1]!.id });
  } else {
    const window = mode === 'popular' ? '7 days' : '3 days';
    const candidates = await db
      .select({ id: articles.id, publishedAt: articles.publishedAt, engagement })
      .from(articles)
      .innerJoin(categories, eq(articles.categoryId, categories.id))
      .where(and(isLive, inSections, sql`${articles.publishedAt} > now() - ${sql.raw(`interval '${window}'`)}`))
      .orderBy(desc(articles.publishedAt))
      .limit(200);
    const now = Date.now();
    const scored = candidates
      .map((c) => {
        const hours = (now - c.publishedAt.getTime()) / 3_600_000;
        const score = mode === 'popular' ? c.engagement + 1 / (hours + 1) : ((1 + c.engagement) / Math.pow(hours + 2, 1.3)) * (0.85 + 0.3 * jitter(seed, c.id));
        return { id: c.id, score };
      })
      .sort((a, b) => b.score - a.score);
    const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    const ids = scored.slice(offset, offset + PAGE).map((x) => x.id);
    if (scored.length > offset + PAGE) next = String(offset + PAGE);
    const found = ids.length ? await cardsQuery(db).where(inArray(articles.id, ids)) : [];
    rows = ids.flatMap((id) => found.filter((f) => f.id === id));
    // Not enough recent articles in the reader's topics: the latest ones fill the first page.
    if (!cursor && rows.length < 4) {
      const more = await cardsQuery(db)
        .where(and(isLive, inSections))
        .orderBy(desc(articles.publishedAt))
        .limit(PAGE);
      rows = [...rows, ...more.filter((m) => !rows.some((r) => r.id === m.id))].slice(0, PAGE);
      next = null;
    }
  }

  const ids = rows.map((r) => r.id);
  const [counts, tops] = ids.length
    ? await Promise.all([
        db
          .select({ articleId: comments.articleId, n: sql<number>`count(*)::int` })
          .from(comments)
          .where(and(inArray(comments.articleId, ids), eq(comments.status, 'visible')))
          .groupBy(comments.articleId),
        // The top comment of each article: the editors' pick, else the most liked, else the latest.
        db
          .selectDistinctOn([comments.articleId], {
            articleId: comments.articleId,
            id: comments.id,
            body: comments.body,
            likeCount: comments.likeCount,
            pickedAt: comments.pickedAt,
            author: readers.displayName,
            replies: sql<number>`(select count(*)::int from comments r where r.parent_id = ${comments.id} and r.status = 'visible')`,
          })
          .from(comments)
          .innerJoin(readers, eq(comments.readerId, readers.id))
          .where(and(inArray(comments.articleId, ids), eq(comments.status, 'visible'), isNull(comments.parentId)))
          .orderBy(comments.articleId, sql`${comments.pickedAt} desc nulls last`, desc(comments.likeCount), desc(comments.createdAt)),
      ])
    : [[], []];

  return {
    items: rows.map((r) => {
      const top = tops.find((t) => t.articleId === r.id);
      return {
        article: toCard(r, config.mediaBaseUrl),
        commentCount: counts.find((c) => c.articleId === r.id)?.n ?? 0,
        topComment: top
          ? { id: top.id, author: top.author, body: top.body.length > 280 ? `${top.body.slice(0, 280)}…` : top.body, likeCount: top.likeCount, picked: Boolean(top.pickedAt), replies: top.replies }
          : null,
      };
    }),
    nextCursor: next,
    sections,
  };
}
