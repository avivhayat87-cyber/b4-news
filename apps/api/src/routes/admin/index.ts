// /api/v1/admin/*: the CMS. Every route needs a signed-in staff member; viewers
// may only read. Routes add stricter role checks where needed.
import type { FastifyPluginAsync } from 'fastify';
import { errors } from '../../errors';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { adminCommentRoutes } from '../admin-comments';
import { discoveryRoutes } from './discovery';
import { draftRoutes } from './drafts';
import { mediaRoutes } from './media';
import { overviewRoutes } from './overview';
import { settingsRoutes } from './settings';
import { sourceRoutes } from './sources';

export const adminRoutes: FastifyPluginAsync<{ s: Services }> = async (app, { s }) => {
  // onRequest: unauthenticated requests are refused before any body (or upload) is read.
  app.addHook('onRequest', async (req) => {
    const staff = requireStaff(req);
    if (staff.role === 'viewer' && req.method !== 'GET') throw errors.forbidden();
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  await app.register(overviewRoutes, { s });
  await app.register(settingsRoutes, { s });
  await app.register(sourceRoutes, { s });
  await app.register(discoveryRoutes, { s });
  await app.register(mediaRoutes, { s });
  await app.register(draftRoutes, { s });
  await app.register(adminCommentRoutes, { db: s.db });
};
