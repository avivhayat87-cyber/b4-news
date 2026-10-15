// Public, cacheable content for the site and the app: /api/v1/public/*
import {
  ArticleCard,
  ArticleFull,
  CategoryPage,
  CategoryRef,
  HOMEPAGE_LIMITS,
  HomeData,
  MarketQuote,
  TICKER_SIZE,
  pageOf,
} from '@b4/shared';
import {
  and,
  articles,
  articleTags,
  asc,
  authors,
  categories,
  comments,
  desc,
  eq,
  homepageSlots,
  ilike,
  isNotNull,
  mediaAssets,
  ne,
  notInArray,
  or,
  podcastEpisodes,
  sources,
  sql,
  tags,
  users,
} from '@b4/db';
import type { Db } from '@b4/db';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import { errors } from '../errors';
import { cardColumns, cardsQuery, decodeCursor, encodeCursor, isLive, olderThan, toCard } from '../lib/cards';
import { marketQuotes } from '../lib/markets';

const PAGE_SIZE = 20;
const SECTION_SIZE = 6;

function publicCache(reply: FastifyReply, seconds = 60) {
  reply.header('cache-control', `public, max-age=${Math.min(seconds, 30)}, s-maxage=${seconds}, stale-while-revalidate=300`);
}

export const contentRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const card = (row: Parameters<typeof toCard>[0]) => toCard(row, config.mediaBaseUrl);

  const zoneCards = (zone: 'main' | 'trending', limit: number) =>
    db
      .select(cardColumns)
      .from(homepageSlots)
      .innerJoin(articles, eq(homepageSlots.articleId, articles.id))
      .innerJoin(categories, eq(articles.categoryId, categories.id))
      .leftJoin(authors, eq(articles.authorId, authors.id))
      .leftJoin(mediaAssets, eq(articles.heroMediaId, mediaAssets.id))
      .where(and(eq(homepageSlots.zone, zone), isLive))
      .orderBy(asc(homepageSlots.position))
      .limit(limit);

  app.get('/home', { schema: { response: { 200: HomeData } } }, async (_req, reply) => {
    const cats = await db
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder));

    const [main, trending, latest, ticker, podcasts, ...sections] = await Promise.all([
      zoneCards('main', HOMEPAGE_LIMITS.main),
      zoneCards('trending', HOMEPAGE_LIMITS.trending),
      cardsQuery(db).where(isLive).orderBy(desc(articles.publishedAt)).limit(8),
      // The ticker: the newest articles marked for it; the oldest drops off as a new one comes.
      cardsQuery(db)
        .where(and(isLive, isNotNull(articles.tickerAt)))
        .orderBy(desc(articles.tickerAt))
        .limit(TICKER_SIZE),
      db.select().from(podcastEpisodes).orderBy(desc(podcastEpisodes.publishedAt)).limit(3),
      ...cats.map((c) =>
        cardsQuery(db)
          .where(and(isLive, eq(articles.categoryId, c.id)))
          .orderBy(desc(articles.publishedAt))
          .limit(SECTION_SIZE),
      ),
    ]);

    publicCache(reply);
    return {
      // Main stories are shown large (rotating hero and featured cards): send the 1600px rendition.
      main: main.map((row) => toCard(row, config.mediaBaseUrl, 'hero')),
      trending: trending.map(card),
      latest: latest.map(card),
      // Until any article is marked for it, the ticker runs the latest ones, as it always did.
      breaking: (ticker.length ? ticker : latest).map(card),
      sections: cats
        .map((c, i) => ({ category: { slug: c.slug, name: c.name }, items: (sections[i] ?? []).map(card) }))
        .filter((s) => s.items.length > 0),
      podcasts: podcasts.map((p) => ({
        id: p.id,
        show: p.show,
        title: p.title,
        meta: [p.episodeNumber ? `פרק ${p.episodeNumber}` : null, p.durationSec ? `${Math.round(p.durationSec / 60)} דק׳` : null]
          .filter(Boolean)
          .join(' · '),
        href: p.url,
      })),
    };
  });

  app.get('/categories', { schema: { response: { 200: z.array(CategoryRef) } } }, async (_req, reply) => {
    publicCache(reply, 3600);
    return db
      .select({ slug: categories.slug, name: categories.name })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder));
  });

  app.get(
    '/categories/:slug',
    {
      schema: {
        params: z.object({ slug: z.string().max(80) }),
        querystring: z.object({ cursor: z.string().max(200).optional() }),
        response: { 200: CategoryPage },
      },
    },
    async (req, reply) => {
      const [cat] = await db
        .select({ id: categories.id, slug: categories.slug, name: categories.name })
        .from(categories)
        .where(and(eq(categories.slug, req.params.slug), eq(categories.isActive, true)))
        .limit(1);
      if (!cat) throw errors.notFound('המדור');
      const rows = await cardsQuery(db)
        .where(and(isLive, eq(articles.categoryId, cat.id), olderThan(decodeCursor(req.query.cursor))))
        .orderBy(desc(articles.publishedAt), desc(articles.id))
        .limit(PAGE_SIZE + 1);
      const items = rows.slice(0, PAGE_SIZE).map(card);
      publicCache(reply);
      return {
        category: { slug: cat.slug, name: cat.name },
        page: { items, nextCursor: rows.length > PAGE_SIZE && items.length ? encodeCursor(items[items.length - 1]!) : null },
      };
    },
  );

  app.get(
    '/articles/:slug',
    { schema: { params: z.object({ slug: z.string().max(300) }), response: { 200: ArticleFull } } },
    async (req, reply) => {
      const [row] = await db
        .select({
          ...cardColumns,
          subtitle: articles.subtitle,
          bodyHtml: articles.bodyHtml,
          updatedAt: articles.updatedAt,
          readingMinutes: articles.readingMinutes,
          commentsEnabled: articles.commentsEnabled,
          disclosure: articles.disclosure,
          sourceUrl: articles.sourceUrl,
          sourceName: sources.name,
          editorName: users.fullName,
        })
        .from(articles)
        .innerJoin(categories, eq(articles.categoryId, categories.id))
        .leftJoin(authors, eq(articles.authorId, authors.id))
        .leftJoin(mediaAssets, eq(articles.heroMediaId, mediaAssets.id))
        .leftJoin(sources, eq(articles.sourceId, sources.id))
        .leftJoin(users, eq(articles.editorId, users.id))
        .where(and(eq(articles.slug, req.params.slug), isLive))
        .limit(1);
      if (!row) throw errors.notFound('הכתבה');

      const [tagRows, [counted]] = await Promise.all([
        db
          .select({ slug: tags.slug, name: tags.name })
          .from(articleTags)
          .innerJoin(tags, eq(articleTags.tagId, tags.id))
          .where(eq(articleTags.articleId, row.id)),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(comments)
          .where(and(eq(comments.articleId, row.id), eq(comments.status, 'visible'))),
      ]);

      publicCache(reply);
      return {
        ...toCard(row, config.mediaBaseUrl, 'hero'),
        subtitle: row.subtitle,
        bodyHtml: row.bodyHtml,
        tags: tagRows,
        editor: row.editorName ? { name: row.editorName } : null,
        updatedAt: row.updatedAt.toISOString(),
        readingMinutes: row.readingMinutes,
        source: row.sourceName && row.sourceUrl ? { name: row.sourceName, url: row.sourceUrl } : null,
        commentsEnabled: row.commentsEnabled,
        disclosure: row.disclosure,
        commentCount: counted?.n ?? 0,
      };
    },
  );

  app.get(
    '/articles/:slug/related',
    { schema: { params: z.object({ slug: z.string().max(300) }), response: { 200: z.array(ArticleCard) } } },
    async (req, reply) => {
      const [self] = await db
        .select({ id: articles.id, categoryId: articles.categoryId })
        .from(articles)
        .where(and(eq(articles.slug, req.params.slug), isLive))
        .limit(1);
      if (!self) throw errors.notFound('הכתבה');
      const sameCategory = await cardsQuery(db)
        .where(and(isLive, eq(articles.categoryId, self.categoryId), ne(articles.id, self.id)))
        .orderBy(desc(articles.publishedAt))
        .limit(6);
      let rows = sameCategory;
      if (rows.length < 6) {
        const exclude = [self.id, ...rows.map((r) => r.id)];
        const more = await cardsQuery(db)
          .where(and(isLive, notInArray(articles.id, exclude)))
          .orderBy(desc(articles.publishedAt))
          .limit(6 - rows.length);
        rows = [...rows, ...more];
      }
      publicCache(reply);
      return rows.map(card);
    },
  );

  app.get(
    '/a/:id',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }), response: { 200: z.object({ slug: z.string() }) } } },
    async (req, reply) => {
      const [row] = await db
        .select({ slug: articles.slug })
        .from(articles)
        .where(and(eq(articles.id, req.params.id), isLive))
        .limit(1);
      if (!row) throw errors.notFound('הכתבה');
      publicCache(reply, 3600);
      return row;
    },
  );

  app.get(
    '/feed',
    {
      schema: {
        querystring: z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(500).default(PAGE_SIZE) }),
        response: { 200: pageOf(ArticleCard) },
      },
    },
    async (req, reply) => {
      const { limit } = req.query;
      const rows = await cardsQuery(db)
        .where(and(isLive, olderThan(decodeCursor(req.query.cursor))))
        .orderBy(desc(articles.publishedAt), desc(articles.id))
        .limit(limit + 1);
      const items = rows.slice(0, limit).map(card);
      publicCache(reply);
      return { items, nextCursor: rows.length > limit && items.length ? encodeCursor(items[items.length - 1]!) : null };
    },
  );

  app.get(
    '/search',
    {
      schema: {
        querystring: z.object({ q: z.string().trim().min(1).max(100), cursor: z.string().max(200).optional() }),
        response: { 200: pageOf(ArticleCard) },
      },
    },
    async (req, reply) => {
      const { q } = req.query;
      const likeTerm = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const rows = await cardsQuery(db)
        .where(
          and(
            isLive,
            or(sql`${articles.searchVector} @@ plainto_tsquery('simple', ${q})`, ilike(articles.title, likeTerm)),
            olderThan(decodeCursor(req.query.cursor)),
          ),
        )
        .orderBy(desc(articles.publishedAt), desc(articles.id))
        .limit(PAGE_SIZE + 1);
      const items = rows.slice(0, PAGE_SIZE).map(card);
      reply.header('cache-control', 'public, max-age=30');
      return { items, nextCursor: rows.length > PAGE_SIZE && items.length ? encodeCursor(items[items.length - 1]!) : null };
    },
  );

  // Official exchange rates (Bank of Israel). Empty when unavailable: the site hides the widgets.
  app.get('/markets', { schema: { response: { 200: z.array(MarketQuote) } } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return marketQuotes();
  });
};
