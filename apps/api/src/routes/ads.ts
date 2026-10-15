// /api/v1/public/ads/*: the ads the site and the app show (services/ads/serve.ts), the views and
// clicks they count, the lead forms, the "advertise with us" form, and an advertiser's private
// page (/public/partners/:key). Never cached: every place asks for its ad when the page shows.
import { AD_SLOTS, AdInquiryInput, AdLeadInput, AdViewInput, PartnerReportDto, PublicAdQuery, PublicAdSlot } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { submitInquiry, submitLead, partnerReport } from '../services/ads/leads';
import { recordClick, recordView, serveAd } from '../services/ads/serve';
import type { Services } from '../services/context';

export const publicAdRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get(
    '/ads/:slot',
    { schema: { params: z.object({ slot: z.enum(AD_SLOTS) }), querystring: PublicAdQuery, response: { 200: PublicAdSlot } }, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req) => serveAd(s, req.params.slot, req.query),
  );

  app.post('/ads/view', { schema: { body: AdViewInput }, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    await recordView(s, req.body.token, req.body.kind);
    return reply.status(204).send();
  });

  // A click goes through us (counted), then on to the advertiser; a stale link lands on the home page.
  app.get('/ads/go/:token', { schema: { params: z.object({ token: z.string().max(300) }) }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const to = await recordClick(s, req.params.token);
    return reply.redirect(to ?? s.config.publicSiteUrl, 302);
  });

  app.post(
    '/ads/lead',
    { schema: { body: AdLeadInput, response: { 201: z.object({ thankYou: z.string() }) } }, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => reply.status(201).send(await submitLead(s, req.body, req.ip)),
  );

  app.post('/ads/inquiry', { schema: { body: AdInquiryInput }, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    await submitInquiry(s, req.body, req.ip);
    return reply.status(204).send();
  });

  app.get(
    '/partners/:key',
    { schema: { params: z.object({ key: z.string().max(100) }), response: { 200: PartnerReportDto } }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => partnerReport(s, req.params.key),
  );
};
