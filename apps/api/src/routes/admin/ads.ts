// Advertising in the CMS (services/ads/*): the switches, advertisers, campaigns and their ads,
// pictures, numbers, leads, and the ads agent. Admins only, reading included: leads are personal
// data, and what runs on the site is an admin's call.
import multipart from '@fastify/multipart';
import {
  AD_SIZES,
  AdBriefInput,
  AdComposeDto,
  AdComposeInput,
  AdDayDto,
  AdDrawInput,
  AdImageDto,
  AdLeadDto,
  AdLeadsQuery,
  AdSettings,
  AdTaskDto,
  AdvertiserDto,
  AdvertiserInput,
  AdsOverviewDto,
  CampaignDto,
  CampaignInput,
  CreativeInput,
  SetCampaignStatusInput,
  SetLeadStatusInput,
} from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../errors';
import { audit } from '../../lib/audit';
import { type FitRule, ingestAdImage } from '../../lib/images';
import { requireStaff } from '../../plugins/auth';
import { composeBanner } from '../../services/ads/banner';
import * as ads from '../../services/ads/campaigns';
import * as leads from '../../services/ads/leads';
import * as agent from '../../services/agent/ads';
import type { Services } from '../../services/context';
import { revalidateSite } from '../../services/publish';

const MAX_UPLOAD = 10 * 1024 * 1024;
const params = z.object({ id: z.string().uuid() });
/** What a picture is for: a banner's own sizes (exact), a native card's picture, or a photo to set a banner on. */
const IMAGE_USES = ['billboard-desktop', 'billboard-mobile', 'rectangle', 'native', 'photo'] as const;
const USE: Record<(typeof IMAGE_USES)[number], { name: string; size: { width: number; height: number }; fit: FitRule }> = {
  'billboard-desktop': { name: 'desktop', size: AD_SIZES.billboard.desktop, fit: 'exact' },
  'billboard-mobile': { name: 'mobile', size: AD_SIZES.billboard.mobile, fit: 'exact' },
  rectangle: { name: 'desktop', size: AD_SIZES.rectangle.desktop, fit: 'exact' },
  native: { name: 'photo', size: AD_SIZES.native.desktop, fit: 'cover' },
  photo: { name: 'photo', size: { width: 300, height: 200 }, fit: 'free' },
};

export const adsRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 1, fields: 2, parts: 3 } });
  app.addHook('preHandler', async (req) => {
    requireStaff(req, 'admin');
  });

  app.get('/ads', { schema: { response: { 200: AdsOverviewDto } } }, async () => ads.adsOverview(s));

  // Turning Google on or off changes what the cookie banner asks and the site's ads.txt: the site's "site" pages refresh.
  app.put('/ads/settings', { schema: { body: AdSettings, response: { 200: AdSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const saved = await ads.saveAdSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'ads', entityId: 'settings', action: 'update', details: saved });
    await revalidateSite(s, ['site']).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'site revalidate failed'));
    return saved;
  });

  // --- Advertisers ---------------------------------------------------------------------------------
  app.post('/ads/advertisers', { schema: { body: AdvertiserInput, response: { 201: AdvertiserDto } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const created = await ads.createAdvertiser(s, req.body);
    await audit(s.db, { userId: staff.id, entity: 'advertiser', entityId: created.id, action: 'create', details: { name: created.name } });
    return reply.status(201).send(created);
  });

  app.put('/ads/advertisers/:id', { schema: { params, body: AdvertiserInput, response: { 200: AdvertiserDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.updateAdvertiser(s, req.params.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'advertiser', entityId: req.params.id, action: 'update', details: { name: updated.name } });
    return updated;
  });

  app.delete('/ads/advertisers/:id', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await ads.deleteAdvertiser(s, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'advertiser', entityId: req.params.id, action: 'delete' });
    return reply.status(204).send();
  });

  // The old link stops working: recorded (it decides who can see the leads).
  app.post('/ads/advertisers/:id/new-link', { schema: { params, response: { 200: AdvertiserDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.renewAdvertiserLink(s, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'advertiser', entityId: req.params.id, action: 'new_link' });
    return updated;
  });

  // --- Campaigns and their ads ---------------------------------------------------------------------
  app.get('/ads/campaigns/:id', { schema: { params, response: { 200: CampaignDto } } }, async (req) => ads.campaignDetail(s, req.params.id));

  app.post('/ads/campaigns', { schema: { body: CampaignInput, response: { 201: CampaignDto } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const created = await ads.createCampaign(s, staff, req.body);
    await audit(s.db, { userId: staff.id, entity: 'ad_campaign', entityId: created.id, action: 'create', details: { name: created.name, advertiser: created.advertiserName } });
    return reply.status(201).send(created);
  });

  app.put('/ads/campaigns/:id', { schema: { params, body: CampaignInput, response: { 200: CampaignDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.updateCampaign(s, req.params.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'ad_campaign', entityId: req.params.id, action: 'update', details: { name: updated.name } });
    return updated;
  });

  // Approving puts it on the site: recorded with who approved.
  app.post('/ads/campaigns/:id/status', { schema: { params, body: SetCampaignStatusInput, response: { 200: CampaignDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.setCampaignStatus(s, staff, req.params.id, req.body.status);
    await audit(s.db, { userId: staff.id, entity: 'ad_campaign', entityId: req.params.id, action: `status_${req.body.status}` });
    return updated;
  });

  app.put('/ads/campaigns/:id/report-note', { schema: { params, body: z.object({ note: z.string().trim().max(2000) }), response: { 200: CampaignDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    await ads.saveReportNote(s, req.params.id, req.body.note);
    await audit(s.db, { userId: staff.id, entity: 'ad_campaign', entityId: req.params.id, action: 'report_note' });
    return ads.campaignDetail(s, req.params.id);
  });

  // Deletes its numbers and its leads too: only by an admin's explicit act, and recorded.
  app.delete('/ads/campaigns/:id', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const { leads: deleted } = await ads.deleteCampaign(s, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'ad_campaign', entityId: req.params.id, action: 'delete', details: { leads: deleted } });
    return reply.status(204).send();
  });

  app.get('/ads/campaigns/:id/days', { schema: { params, response: { 200: z.array(AdDayDto) } } }, async (req) => ads.campaignDays(s.db, req.params.id, ads.sinceDays(90)));

  app.post('/ads/campaigns/:id/creatives', { schema: { params, body: CreativeInput, response: { 201: CampaignDto } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.addCreative(s, req.params.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'ad_campaign', entityId: req.params.id, action: 'add_creative', details: { format: req.body.format } });
    return reply.status(201).send(updated);
  });

  app.put('/ads/creatives/:id', { schema: { params, body: CreativeInput, response: { 200: CampaignDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.updateCreative(s, req.params.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'ad_creative', entityId: req.params.id, action: 'update', details: { active: req.body.active } });
    return updated;
  });

  app.delete('/ads/creatives/:id', { schema: { params, response: { 200: CampaignDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const updated = await ads.deleteCreative(s, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'ad_creative', entityId: req.params.id, action: 'delete' });
    return updated;
  });

  // --- Pictures ------------------------------------------------------------------------------------
  app.post(
    '/ads/images',
    { schema: { querystring: z.object({ use: z.enum(IMAGE_USES) }), response: { 201: AdImageDto } }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw new AppError(400, 'no_file', 'לא נבחר קובץ');
      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw new AppError(413, 'too_large', 'הקובץ גדול מדי (עד 10MB)');
      }
      const use = USE[req.query.use];
      const saved = await ingestAdImage(s.storage, buffer, { name: use.name, width: use.size.width, height: use.size.height, fit: use.fit });
      return reply.status(201).send({ ...saved, url: s.storage.url(saved.key) });
    },
  );

  // A banner set in the brand fonts from words (free: no AI).
  app.post('/ads/compose', { schema: { body: AdComposeInput, response: { 201: AdComposeDto } }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const photo = req.body.photo ? await s.storage.get(req.body.photo).catch(() => null) : null;
    if (req.body.photo && !photo) throw new AppError(400, 'bad_image', 'התמונה לא נמצאה. העלו אותה שוב.');
    return reply.status(201).send(await composeBanner(s.storage, req.body, photo));
  });

  // --- Leads ---------------------------------------------------------------------------------------
  app.get('/ads/leads', { schema: { querystring: AdLeadsQuery, response: { 200: z.array(AdLeadDto) } } }, async (req) => leads.listLeads(s, req.query));

  app.patch('/ads/leads/:id', { schema: { params, body: SetLeadStatusInput } }, async (req, reply) => {
    requireStaff(req, 'admin');
    await leads.setLeadStatus(s, req.params.id, req.body.status);
    return reply.status(204).send();
  });

  app.delete('/ads/leads/:id', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await leads.deleteLead(s, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'ad_lead', entityId: req.params.id, action: 'delete' });
    return reply.status(204).send();
  });

  // --- The ads agent (each call is paid: a limit, and a record of who asked) --------------------------
  const agentLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/ads/agent/brief', { schema: { body: AdBriefInput, response: { 202: AdTaskDto } }, config: agentLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const task = await agent.startBrief(s, staff, req.body);
    await audit(s.db, { userId: staff.id, entity: 'ad_agent', entityId: task.id, action: 'brief', details: { business: req.body.business } });
    return reply.status(202).send(task);
  });

  app.post('/ads/creatives/:id/review', { schema: { params, response: { 202: AdTaskDto } }, config: agentLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    return reply.status(202).send(await agent.startReview(s, staff, req.params.id));
  });

  app.post('/ads/campaigns/:id/report', { schema: { params, response: { 202: AdTaskDto } }, config: agentLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    return reply.status(202).send(await agent.startReport(s, staff, req.params.id));
  });

  app.post('/ads/agent/draw', { schema: { body: AdDrawInput, response: { 202: AdTaskDto } }, config: agentLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const task = await agent.startDraw(s, staff, req.body.idea);
    await audit(s.db, { userId: staff.id, entity: 'ad_agent', entityId: task.id, action: 'draw' });
    return reply.status(202).send(task);
  });

  app.get('/ads/agent/tasks/:id', { schema: { params, response: { 200: AdTaskDto } } }, async (req) => agent.adTask(s, req.params.id));
};
