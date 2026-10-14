// /api/v1/admin/audience, readers, newsletter: the CMS's "מנויים וגולשים". The lists hold
// personal details, so viewers don't see them; editors moderate, only admins delete for good.
// (Banning a reader is POST /admin/readers/:id/ban, next to the comments it hides.)
import { AudienceOverview, ReaderList, ReaderListQuery, SubscriberList, SubscriberListQuery } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireStaff } from '../../plugins/auth';
import {
  audienceOverview,
  deleteReader,
  deleteSubscriber,
  listReaders,
  listSubscribers,
  signOutReader,
  unbanReader,
  unsubscribeSubscriber,
} from '../../services/audience';
import type { Services } from '../../services/context';

const params = z.object({ id: z.string().uuid() });

export const audienceRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/audience', { schema: { response: { 200: AudienceOverview } } }, async () => audienceOverview(s));

  // --- Readers --------------------------------------------------------------------------------------
  app.get('/readers', { schema: { querystring: ReaderListQuery, response: { 200: ReaderList } } }, async (req) => {
    requireStaff(req, 'editor');
    return listReaders(s, req.query);
  });

  app.post('/readers/:id/unban', { schema: { params } }, async (req, reply) => {
    await unbanReader(s, requireStaff(req, 'editor'), req.params.id);
    return reply.status(204).send();
  });

  app.post('/readers/:id/sign-out', { schema: { params } }, async (req, reply) => {
    await signOutReader(s, requireStaff(req, 'editor'), req.params.id);
    return reply.status(204).send();
  });

  app.delete('/readers/:id', { schema: { params } }, async (req, reply) => {
    await deleteReader(s, requireStaff(req, 'admin'), req.params.id);
    return reply.status(204).send();
  });

  // --- Newsletter subscribers --------------------------------------------------------------------------
  app.get('/newsletter/subscribers', { schema: { querystring: SubscriberListQuery, response: { 200: SubscriberList } } }, async (req) => {
    requireStaff(req, 'editor');
    return listSubscribers(s, req.query);
  });

  app.post('/newsletter/subscribers/:id/unsubscribe', { schema: { params } }, async (req, reply) => {
    await unsubscribeSubscriber(s, requireStaff(req, 'editor'), req.params.id);
    return reply.status(204).send();
  });

  app.delete('/newsletter/subscribers/:id', { schema: { params } }, async (req, reply) => {
    await deleteSubscriber(s, requireStaff(req, 'admin'), req.params.id);
    return reply.status(204).send();
  });
};
