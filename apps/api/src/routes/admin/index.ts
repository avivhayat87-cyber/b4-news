// /api/v1/admin/*: the CMS. Every route needs a signed-in staff member; viewers
// may only read. Routes add stricter role checks where needed.
import type { FastifyPluginAsync } from 'fastify';
import { errors } from '../../errors';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { adminCommentRoutes } from '../admin-comments';
import { adminTakedownRoutes } from '../takedowns';
import { agentRoutes } from './agent';
import { articleRoutes } from './articles';
import { audienceRoutes } from './audience';
import { discoveryRoutes } from './discovery';
import { draftRoutes } from './drafts';
import { mediaRoutes } from './media';
import { overviewRoutes } from './overview';
import { reviewRoutes } from './review';
import { securityRoutes } from './security';
import { settingsRoutes } from './settings';
import { socialRoutes } from './social';
import { socialAccountRoutes } from './social-accounts';
import { sourceRoutes } from './sources';

export const adminRoutes: FastifyPluginAsync<{ s: Services }> = async (app, { s }) => {
  // onRequest: unauthenticated requests are refused before any body (or upload) is read.
  app.addHook('onRequest', async (req) => {
    const staff = requireStaff(req);
    const route = req.routeOptions.url ?? '';
    // A personal access token (the Claude app) reaches only the agent's tools, which check roles themselves.
    if (staff.apiTokenId && !route.includes('/admin/agent/tools')) throw errors.forbidden();
    // Viewers may chat with the agent (it gives them read-only tools) and manage their own sign-in
    // (password, two-step); everything else they may only read.
    const chat = /\/admin\/agent\/(messages|conversations\/)/.test(route);
    const ownAccount = /\/admin\/me\//.test(route);
    if (staff.role === 'viewer' && req.method !== 'GET' && !chat && !ownAccount) throw errors.forbidden();
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  await app.register(overviewRoutes, { s });
  await app.register(securityRoutes, { s });
  await app.register(settingsRoutes, { s });
  await app.register(socialAccountRoutes, { s });
  await app.register(sourceRoutes, { s });
  await app.register(discoveryRoutes, { s });
  await app.register(mediaRoutes, { s });
  await app.register(draftRoutes, { s });
  await app.register(reviewRoutes, { s });
  await app.register(articleRoutes, { s });
  await app.register(socialRoutes, { s });
  await app.register(agentRoutes, { s });
  await app.register(adminCommentRoutes, { db: s.db });
  await app.register(audienceRoutes, { s });
  await app.register(adminTakedownRoutes, { s });
};
