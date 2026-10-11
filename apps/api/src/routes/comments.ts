// Reader comments.
//   GET    /api/v1/public/articles/:id/comments   everyone (own pending comments included for their author)
//   POST   /api/v1/articles/:id/comments          signed-in reader
//   DELETE /api/v1/comments/:id                   the comment's author
//   POST   /api/v1/comments/:id/report            signed-in reader
import { COMMENT_LIMITS, CommentDto, CommentList, CreateCommentInput, ReportCommentInput } from '@b4/shared';
import { type Db, and, articles, asc, commentReports, comments, desc, eq, inArray, isNull, or, readers, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import { moderateComment } from '../lib/moderation';
import { requireReader } from '../plugins/auth';

const PAGE_SIZE = 20;
const DAILY_LIMIT = 50;

const commentColumns = {
  id: comments.id,
  parentId: comments.parentId,
  body: comments.body,
  status: comments.status,
  createdAt: comments.createdAt,
  readerId: comments.readerId,
  displayName: readers.displayName,
};

type Row = { id: string; parentId: string | null; body: string; status: string; createdAt: Date; readerId: string; displayName: string };

function toDto(row: Row, viewerId: string | undefined): CommentDto {
  return {
    id: row.id,
    parentId: row.parentId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.readerId, displayName: row.displayName },
    isMine: row.readerId === viewerId,
    pending: row.status === 'hidden',
  };
}

const ArticleParams = z.object({ id: z.coerce.number().int().positive() });
const CommentParams = z.object({ id: z.string().uuid() });

async function commentableArticle(db: Db, id: number) {
  const [article] = await db
    .select({ id: articles.id, commentsEnabled: articles.commentsEnabled })
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.status, 'published')))
    .limit(1);
  if (!article) throw errors.notFound('הכתבה');
  return article;
}

/** Comments the viewer may see: visible ones, plus their own held for review. */
function viewable(viewerId: string | undefined) {
  return viewerId
    ? or(eq(comments.status, 'visible'), and(eq(comments.status, 'hidden'), eq(comments.readerId, viewerId)))
    : eq(comments.status, 'visible');
}

export const publicCommentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/articles/:id/comments',
    {
      schema: {
        params: ArticleParams,
        querystring: z.object({ cursor: z.string().max(200).optional() }),
        response: { 200: CommentList },
      },
    },
    async (req, reply) => {
      const viewerId = req.reader?.id;
      await commentableArticle(db, req.params.id);
      const cursor = decode(req.query.cursor);

      // Page through top-level comments (newest first), then attach their replies (oldest first).
      const top = await db
        .select(commentColumns)
        .from(comments)
        .innerJoin(readers, eq(comments.readerId, readers.id))
        .where(
          and(
            eq(comments.articleId, req.params.id),
            isNull(comments.parentId),
            viewable(viewerId),
            cursor ? sql`(${comments.createdAt}, ${comments.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(comments.createdAt), desc(comments.id))
        .limit(PAGE_SIZE + 1);
      const page = top.slice(0, PAGE_SIZE);
      const replies = page.length
        ? await db
            .select(commentColumns)
            .from(comments)
            .innerJoin(readers, eq(comments.readerId, readers.id))
            .where(and(inArray(comments.parentId, page.map((c) => c.id)), viewable(viewerId)))
            .orderBy(asc(comments.createdAt))
        : [];
      const [total] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(comments)
        .where(and(eq(comments.articleId, req.params.id), eq(comments.status, 'visible')));

      const items = page.flatMap((c) => [c, ...replies.filter((r) => r.parentId === c.id)]).map((r) => toDto(r, viewerId));
      const last = page[page.length - 1];
      reply.header('cache-control', 'private, no-store');
      return { items, total: total?.n ?? 0, nextCursor: top.length > PAGE_SIZE && last ? encode(last) : null };
    },
  );
};

export const commentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.post(
    '/articles/:id/comments',
    {
      schema: { params: ArticleParams, body: CreateCommentInput, response: { 201: CommentDto } },
      config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: (req) => req.reader?.id ?? req.ip } },
    },
    async (req, reply) => {
      const reader = requireReader(req);
      const article = await commentableArticle(db, req.params.id);
      if (!article.commentsEnabled) throw new AppError(403, 'comments_closed', 'התגובות לכתבה הזאת סגורות');

      const verdict = moderateComment(req.body.body);
      if (verdict.decision === 'reject') throw new AppError(400, verdict.code, verdict.message);

      // Replies stay one level deep: a reply to a reply attaches to the thread's first comment.
      let parentId: string | null = null;
      if (req.body.parentId) {
        const [parent] = await db
          .select({ id: comments.id, parentId: comments.parentId })
          .from(comments)
          .where(and(eq(comments.id, req.body.parentId), eq(comments.articleId, article.id), eq(comments.status, 'visible')))
          .limit(1);
        if (!parent) throw errors.notFound('התגובה שמגיבים אליה');
        parentId = parent.parentId ?? parent.id;
      }

      const [stats] = await db
        .select({
          today: sql<number>`count(*) filter (where ${comments.createdAt} > now() - interval '1 day')::int`,
          duplicate: sql<number>`count(*) filter (where ${comments.createdAt} > now() - interval '10 minutes' and ${comments.body} = ${verdict.body})::int`,
        })
        .from(comments)
        .where(eq(comments.readerId, reader.id));
      if ((stats?.today ?? 0) >= DAILY_LIMIT) throw errors.rateLimited();
      if ((stats?.duplicate ?? 0) > 0) throw new AppError(409, 'duplicate', 'כבר פרסמת את התגובה הזאת');

      const [created] = await db
        .insert(comments)
        .values({
          articleId: article.id,
          readerId: reader.id,
          parentId,
          body: verdict.body,
          status: verdict.decision === 'publish' ? 'visible' : 'hidden',
          moderationNote: verdict.decision === 'review' ? verdict.reason : null,
        })
        .returning();
      if (!created) throw new Error('comment insert failed');

      return reply.status(201).send(toDto({ ...created, displayName: reader.displayName }, reader.id));
    },
  );

  app.delete('/comments/:id', { schema: { params: CommentParams } }, async (req, reply) => {
    const reader = requireReader(req);
    const [updated] = await db
      .update(comments)
      .set({ status: 'removed' })
      .where(and(eq(comments.id, req.params.id), eq(comments.readerId, reader.id)))
      .returning({ id: comments.id });
    if (!updated) throw errors.notFound('התגובה');
    return reply.status(204).send();
  });

  app.post(
    '/comments/:id/report',
    {
      schema: { params: CommentParams, body: ReportCommentInput },
      config: { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator: (req) => req.reader?.id ?? req.ip } },
    },
    async (req, reply) => {
      const reader = requireReader(req);
      const [target] = await db
        .select({ id: comments.id, readerId: comments.readerId })
        .from(comments)
        .where(and(eq(comments.id, req.params.id), eq(comments.status, 'visible')))
        .limit(1);
      if (!target) throw errors.notFound('התגובה');
      if (target.readerId === reader.id) throw new AppError(400, 'own_comment', 'אי אפשר לדווח על תגובה שלך');

      const inserted = await db
        .insert(commentReports)
        .values({ commentId: target.id, readerId: reader.id, reason: req.body.reason, note: req.body.note ?? null })
        .onConflictDoNothing()
        .returning({ commentId: commentReports.commentId });
      if (inserted.length) {
        // Enough reports from different readers hide the comment until a moderator decides.
        const [after] = await db
          .update(comments)
          .set({
            reportCount: sql`${comments.reportCount} + 1`,
            status: sql`case when ${comments.reportCount} + 1 >= ${COMMENT_LIMITS.autoHideReports} then 'hidden'::comment_status else ${comments.status} end`,
          })
          .where(eq(comments.id, target.id))
          .returning({ status: comments.status, reportCount: comments.reportCount });
        if (after?.status === 'hidden') {
          await audit(db, { readerId: reader.id, entity: 'comment', entityId: target.id, action: 'auto_hidden', details: { reports: after.reportCount } });
        }
      }
      return reply.status(204).send();
    },
  );
};

function encode(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decode(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}
