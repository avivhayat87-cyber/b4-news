// Comment moderation for the CMS: /api/v1/admin/*
import { COMMENT_STATUSES } from '@b4/shared';
import { type Db, and, articles, comments, desc, eq, gt, readers, sessions, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../errors';
import { audit } from '../lib/audit';
import { requireStaff } from '../plugins/auth';

const AdminComment = z.object({
  id: z.string().uuid(),
  body: z.string(),
  status: z.enum(COMMENT_STATUSES),
  reportCount: z.number().int(),
  moderationNote: z.string().nullable(),
  createdAt: z.string(),
  article: z.object({ id: z.number().int(), title: z.string(), slug: z.string() }),
  reader: z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string(), status: z.enum(['active', 'banned']) }),
});

export const adminCommentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/comments',
    {
      schema: {
        querystring: z.object({
          status: z.enum(COMMENT_STATUSES).optional(),
          reported: z.enum(['true', 'false']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.object({ items: z.array(AdminComment) }) },
      },
    },
    async (req) => {
      requireStaff(req, 'editor');
      const rows = await db
        .select({
          id: comments.id,
          body: comments.body,
          status: comments.status,
          reportCount: comments.reportCount,
          moderationNote: comments.moderationNote,
          createdAt: comments.createdAt,
          articleId: articles.id,
          articleTitle: articles.title,
          articleSlug: articles.slug,
          readerId: readers.id,
          readerName: readers.displayName,
          readerEmail: readers.email,
          readerStatus: readers.status,
        })
        .from(comments)
        .innerJoin(articles, eq(comments.articleId, articles.id))
        .innerJoin(readers, eq(comments.readerId, readers.id))
        .where(
          and(
            req.query.status ? eq(comments.status, req.query.status) : undefined,
            req.query.reported === 'true' ? gt(comments.reportCount, 0) : undefined,
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(req.query.limit);
      return {
        items: rows.map((r) => ({
          id: r.id,
          body: r.body,
          status: r.status,
          reportCount: r.reportCount,
          moderationNote: r.moderationNote,
          createdAt: r.createdAt.toISOString(),
          article: { id: r.articleId, title: r.articleTitle, slug: r.articleSlug },
          reader: { id: r.readerId, displayName: r.readerName, email: r.readerEmail, status: r.readerStatus },
        })),
      };
    },
  );

  app.patch(
    '/comments/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ status: z.enum(COMMENT_STATUSES), note: z.string().trim().max(500).optional() }),
      },
    },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      const [updated] = await db
        .update(comments)
        .set({ status: req.body.status, moderatedBy: staff.id, moderatedAt: new Date(), moderationNote: req.body.note ?? null })
        .where(eq(comments.id, req.params.id))
        .returning({ id: comments.id });
      if (!updated) throw errors.notFound('התגובה');
      await audit(db, { userId: staff.id, entity: 'comment', entityId: updated.id, action: `set_${req.body.status}`, details: { note: req.body.note } });
      return reply.status(204).send();
    },
  );

  app.post(
    '/readers/:id/ban',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string().trim().min(2).max(500), hideComments: z.boolean().default(true) }),
      },
    },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      const [reader] = await db
        .update(readers)
        .set({ status: 'banned', bannedReason: req.body.reason })
        .where(eq(readers.id, req.params.id))
        .returning({ id: readers.id });
      if (!reader) throw errors.notFound('הקורא');
      await db.delete(sessions).where(eq(sessions.readerId, reader.id));
      if (req.body.hideComments) {
        await db
          .update(comments)
          .set({ status: 'hidden', moderatedBy: staff.id, moderatedAt: sql`now()`, moderationNote: 'reader banned' })
          .where(and(eq(comments.readerId, reader.id), eq(comments.status, 'visible')));
      }
      await audit(db, { userId: staff.id, entity: 'reader', entityId: reader.id, action: 'ban', details: { reason: req.body.reason } });
      return reply.status(204).send();
    },
  );
};
