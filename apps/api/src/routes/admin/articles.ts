// /api/v1/admin/articles: the published articles ("כתבות באתר"), and updating one on the
// site from its draft. Editors change and remove; only admins delete for good.
import { ArticleListQuery, PublishedArticleList } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireStaff } from '../../plugins/auth';
import { deleteArticle, listArticles, openForEditing, republishArticle, setArticleTicker, unpublishArticle, updateSiteFromDraft } from '../../services/articles';
import type { Services } from '../../services/context';

const params = z.object({ id: z.coerce.number().int().positive() });

export const articleRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/articles', { schema: { querystring: ArticleListQuery, response: { 200: PublishedArticleList } } }, async (req) => listArticles(s, req.query));

  app.post('/articles/:id/edit', { schema: { params, response: { 200: z.object({ draftId: z.string().uuid() }) } } }, async (req) =>
    openForEditing(s, requireStaff(req, 'editor'), req.params.id),
  );

  app.post('/articles/:id/unpublish', { schema: { params } }, async (req, reply) => {
    await unpublishArticle(s, requireStaff(req, 'editor'), req.params.id);
    return reply.status(204).send();
  });

  app.post('/articles/:id/republish', { schema: { params } }, async (req, reply) => {
    await republishArticle(s, requireStaff(req, 'editor'), req.params.id);
    return reply.status(204).send();
  });

  /** The breaking-news ticker: put an article at its head, or take it off. */
  app.post('/articles/:id/ticker', { schema: { params, body: z.object({ on: z.boolean() }) } }, async (req, reply) => {
    await setArticleTicker(s, requireStaff(req, 'editor'), req.params.id, req.body.on);
    return reply.status(204).send();
  });

  app.delete('/articles/:id', { schema: { params } }, async (req, reply) => {
    await deleteArticle(s, requireStaff(req, 'admin'), req.params.id);
    return reply.status(204).send();
  });

  /** "שמירה ועדכון באתר" in the editor, for the draft of an article that is on the site. */
  app.post('/drafts/:id/update-article', { schema: { params: z.object({ id: z.string().uuid() }), response: { 200: z.object({ slug: z.string() }) } } }, async (req) =>
    updateSiteFromDraft(s, requireStaff(req, 'editor'), req.params.id),
  );
};
