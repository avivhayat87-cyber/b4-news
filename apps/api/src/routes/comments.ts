// Reader comments.
//   GET    /api/v1/public/articles/:id/comments   everyone (own pending comments included for their author)
//   POST   /api/v1/articles/:id/comments          signed-in reader
//   DELETE /api/v1/comments/:id                   the comment's author
//   POST   /api/v1/comments/:id/report            signed-in reader
//   POST   /api/v1/comments/:id/like, DELETE …    signed-in reader (not their own)
import { COMMENT_LIMITS, COMMENT_SORTS, CommentDto, CommentList, CreateCommentInput, LikeResult, ReportCommentInput } from '@b4/shared';
import { type Db, and, articles, commentReports, comments, eq, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import { moderateComment } from '../lib/moderation';
import { requireReader } from '../plugins/auth';
import { commentDtos, likeComment, listComments, unlikeComment } from '../services/comments';
import type { Services } from '../services/context';
import { notify } from '../services/notifications';
import { legalVersion } from '../services/site-settings';

const DAILY_LIMIT = 50;

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

export const publicCommentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/articles/:id/comments',
    {
      schema: {
        params: ArticleParams,
        querystring: z.object({ cursor: z.string().max(200).optional(), sort: z.enum(COMMENT_SORTS).default('top') }),
        response: { 200: CommentList },
      },
    },
    async (req, reply) => {
      await commentableArticle(db, req.params.id);
      reply.header('cache-control', 'private, no-store');
      return listComments(db, req.params.id, req.reader?.id, req.query.sort, req.query.cursor);
    },
  );
};

export const commentRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  const { db } = s;
  app.post(
    '/articles/:id/comments',
    {
      schema: { params: ArticleParams, body: CreateCommentInput, response: { 201: CommentDto } },
      config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: (req) => req.reader?.id ?? req.ip } },
    },
    async (req, reply) => {
      const reader = requireReader(req);
      if (reader.termsVersion !== (await legalVersion(s))) throw errors.termsRequired();
      const article = await commentableArticle(db, req.params.id);
      if (!article.commentsEnabled) throw new AppError(403, 'comments_closed', 'התגובות לכתבה הזאת סגורות');

      const verdict = moderateComment(req.body.body);
      if (verdict.decision === 'reject') throw new AppError(400, verdict.code, verdict.message);

      // Replies stay one level deep: a reply to a reply attaches to the thread's first comment,
      // and remembers whom it answers ("@name"), who is then notified.
      let parentId: string | null = null;
      let answered: { id: string; readerId: string } | null = null;
      if (req.body.parentId) {
        const [parent] = await db
          .select({ id: comments.id, parentId: comments.parentId, readerId: comments.readerId })
          .from(comments)
          .where(and(eq(comments.id, req.body.parentId), eq(comments.articleId, article.id), eq(comments.status, 'visible')))
          .limit(1);
        if (!parent) throw errors.notFound('התגובה שמגיבים אליה');
        parentId = parent.parentId ?? parent.id;
        answered = { id: parent.id, readerId: parent.readerId };
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
          replyToId: answered?.id ?? null,
          body: verdict.body,
          status: verdict.decision === 'publish' ? 'visible' : 'hidden',
          moderationNote: verdict.decision === 'review' ? verdict.reason : null,
        })
        .returning();
      if (!created) throw new Error('comment insert failed');
      // A reply held for review notifies nobody (it isn't shown yet).
      if (answered && created.status === 'visible') {
        await notify(s, { readerId: answered.readerId, kind: 'reply', commentId: created.id, actorReaderId: reader.id, articleId: article.id });
      }

      const [dto] = await commentDtos(db, [{ ...created, displayName: reader.displayName }], reader.id);
      return reply.status(201).send(dto!);
    },
  );

  const likeRoute = { schema: { params: CommentParams, response: { 200: LikeResult } }, config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (req: { reader?: { id: string } | null; ip: string }) => req.reader?.id ?? req.ip } } };
  app.post('/comments/:id/like', likeRoute, async (req) => likeComment(s, requireReader(req).id, req.params.id));
  app.delete('/comments/:id/like', likeRoute, async (req) => unlikeComment(s, requireReader(req).id, req.params.id));

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

