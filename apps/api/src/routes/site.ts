// /api/v1/public/site and /public/pages/:slug: links, contact details and the
// info pages, as edited in the CMS. Cacheable; the site revalidates tag "site" on change.
import { PAGE_SLUGS, PublicPage, PublicSite } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/context';
import { publicPage, publicSite } from '../services/site-settings';

export const siteRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/site', { schema: { response: { 200: PublicSite } } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
    return publicSite(s);
  });

  app.get('/pages/:slug', { schema: { params: z.object({ slug: z.enum(PAGE_SLUGS) }), response: { 200: PublicPage } } }, async (req, reply) => {
    reply.header('cache-control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
    return publicPage(s, req.params.slug);
  });
};
