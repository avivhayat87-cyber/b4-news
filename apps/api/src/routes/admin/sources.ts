// Site settings ("הגדרות אתרים"): an editor asks for a site by name and address,
// a developer builds and tests its trigger, then approves it and it goes active.
import { BulkSourcesInput, BulkSourcesResult, ConfigureSourceInput, CreateSourceInput, SelectorConfig, SourceDto, SourceTestResult } from '@b4/shared';
import { and, categories, desc, eq, isNotNull, sources, users } from '@b4/db';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../../errors';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { addSources, approveTestedSources, queueSourceSetup, sourcesBeingSetUp } from '../../services/scraper/setup';
import { testSource } from '../../services/scraper/test-source';

const params = z.object({ id: z.string().uuid() });

export const sourceRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  const requester = alias(users, 'requester');
  const approver = alias(users, 'approver');

  async function list(id?: string): Promise<SourceDto[]> {
    const rows = await s.db
      .select({ source: sources, category: categories.slug, requestedBy: requester.fullName, approvedBy: approver.fullName })
      .from(sources)
      .leftJoin(categories, eq(sources.defaultCategoryId, categories.id))
      .leftJoin(requester, eq(sources.requestedBy, requester.id))
      .leftJoin(approver, eq(sources.approvedBy, approver.id))
      .where(id ? eq(sources.id, id) : undefined)
      .orderBy(desc(sources.createdAt));
    const settingUp = await sourcesBeingSetUp(s);
    return rows.map(({ source: r, category, requestedBy, approvedBy }) => {
      const config = r.selectorConfig ? SelectorConfig.safeParse(r.selectorConfig) : null;
      return {
        id: r.id,
        name: r.name,
        baseUrl: r.baseUrl,
        listUrls: r.listUrls,
        method: r.method === 'html_js' ? null : r.method,
        selectorConfig: config?.success ? config.data : null,
        defaultCategory: category,
        region: r.region,
        language: r.language,
        status: r.status,
        scrapeIntervalMin: r.scrapeIntervalMin,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
        lastTestPassedAt: r.lastTestPassedAt?.toISOString() ?? null,
        consecutiveFailures: r.consecutiveFailures,
        devNotes: r.devNotes,
        requestedBy,
        approvedBy,
        approvedAt: r.approvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        setupRunning: settingUp.has(r.id),
      };
    });
  }

  async function one(id: string): Promise<SourceDto> {
    const [row] = await list(id);
    if (!row) throw errors.notFound('האתר');
    return row;
  }

  async function categoryId(slug: string | null | undefined) {
    if (!slug) return null;
    const [c] = await s.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
    return c?.id ?? null;
  }

  app.get('/sources', { schema: { response: { 200: z.array(SourceDto) } } }, async () => list());

  app.post('/sources', { schema: { body: CreateSourceInput, response: { 201: SourceDto } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor', 'developer');
    const [dup] = await s.db.select({ id: sources.id }).from(sources).where(eq(sources.baseUrl, req.body.baseUrl)).limit(1);
    if (dup) throw new AppError(409, 'duplicate', 'האתר הזה כבר קיים ברשימה.');
    const [row] = await s.db
      .insert(sources)
      .values({
        name: req.body.name,
        baseUrl: req.body.baseUrl,
        region: req.body.region,
        defaultCategoryId: await categoryId(req.body.defaultCategory),
        devNotes: req.body.notes ?? null,
        requestedBy: staff.id,
        status: 'pending_dev',
      })
      .returning({ id: sources.id });
    await audit(s.db, { userId: staff.id, entity: 'source', entityId: row!.id, action: 'request' });

    // Let the developers know there is a trigger to build.
    const devs = await s.db.select({ email: users.email }).from(users).where(and(eq(users.role, 'developer'), eq(users.isActive, true)));
    for (const dev of devs) {
      await s.mailer
        .send({
          to: dev.email,
          subject: `בקשה לאתר חדש${req.body.region === 'international' ? ' מחו״ל' : ''}: ${req.body.name}`,
          text: `${staff.fullName} ביקש/ה להוסיף את האתר "${req.body.name}" (${req.body.baseUrl}).\nאפשר להגדיר את הטריגר ב-CMS תחת "הגדרות אתרים".`,
        })
        .catch((err) => s.log.warn({ err }, 'developer notification failed'));
    }
    return reply.status(201).send(await one(row!.id));
  });

  /** Several sites from a list of links: each is created and gets an automatic setup attempt. */
  app.post('/sources/bulk', { schema: { body: BulkSourcesInput, response: { 201: BulkSourcesResult } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor', 'developer');
    return reply.status(201).send(await addSources(s, staff, req.body.urls, req.body.region, await categoryId(req.body.defaultCategory)));
  });

  /** The name shown in discovery and credited in articles. */
  app.patch('/sources/:id', { schema: { params, body: z.object({ name: CreateSourceInput.shape.name }), response: { 200: SourceDto } } }, async (req) => {
    const staff = requireStaff(req, 'editor', 'developer');
    await one(req.params.id);
    await s.db.update(sources).set({ name: req.body.name }).where(eq(sources.id, req.params.id));
    await audit(s.db, { userId: staff.id, entity: 'source', entityId: req.params.id, action: 'rename' });
    return one(req.params.id);
  });

  app.post('/sources/:id/autodetect', { schema: { params, response: { 202: z.object({ jobId: z.string().uuid() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor', 'developer');
    await one(req.params.id);
    return reply.status(202).send({ jobId: await queueSourceSetup(s, req.params.id, staff.id) });
  });

  /** Approves every site whose saved trigger passed its test. */
  app.post('/sources/approve-tested', { schema: { response: { 200: z.object({ approved: z.number().int() }) } } }, async (req) => {
    const staff = requireStaff(req, 'developer');
    return { approved: await approveTestedSources(s, staff.id) };
  });
  app.put('/sources/:id/config', { schema: { params, body: ConfigureSourceInput, response: { 200: SourceDto } } }, async (req) => {
    const staff = requireStaff(req, 'developer');
    const current = await one(req.params.id);
    const changed = JSON.stringify([current.method, current.listUrls, current.selectorConfig]) !== JSON.stringify([req.body.method, req.body.listUrls, req.body.selectorConfig]);
    await s.db
      .update(sources)
      .set({
        method: req.body.method,
        listUrls: req.body.listUrls,
        selectorConfig: req.body.selectorConfig,
        defaultCategoryId: await categoryId(req.body.defaultCategory),
        scrapeIntervalMin: req.body.scrapeIntervalMin,
        devNotes: req.body.devNotes ?? current.devNotes,
        // A changed trigger must be tested again before it runs.
        ...(changed ? { lastTestPassedAt: null } : {}),
        ...(changed && current.status === 'active' ? { status: 'in_development' as const, approvedAt: null, approvedBy: null } : {}),
        ...(current.status === 'pending_dev' ? { status: 'in_development' as const } : {}),
      })
      .where(eq(sources.id, req.params.id));
    await audit(s.db, { userId: staff.id, entity: 'source', entityId: req.params.id, action: 'configure' });
    return one(req.params.id);
  });

  app.post(
    '/sources/:id/test',
    { schema: { params, body: ConfigureSourceInput, response: { 200: SourceTestResult } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      requireStaff(req, 'developer');
      const current = await one(req.params.id);
      const result = await testSource(s.fetch, current.name, req.body);
      const sameAsSaved = JSON.stringify([current.method, current.listUrls, current.selectorConfig]) === JSON.stringify([req.body.method, req.body.listUrls, req.body.selectorConfig]);
      if (result.ok && sameAsSaved) await s.db.update(sources).set({ lastTestPassedAt: new Date() }).where(eq(sources.id, req.params.id));
      return result;
    },
  );

  app.post('/sources/:id/approve', { schema: { params, response: { 200: SourceDto } } }, async (req) => {
    const staff = requireStaff(req, 'developer');
    const current = await one(req.params.id);
    if (!current.method || !current.selectorConfig || current.listUrls.length === 0) throw new AppError(409, 'not_configured', 'צריך לשמור הגדרת טריגר לפני האישור.');
    if (!current.lastTestPassedAt) throw new AppError(409, 'not_tested', 'הריצו בדיקה מוצלחת על ההגדרה השמורה לפני האישור.');
    await s.db.update(sources).set({ status: 'active', approvedBy: staff.id, approvedAt: new Date(), consecutiveFailures: 0 }).where(eq(sources.id, req.params.id));
    await audit(s.db, { userId: staff.id, entity: 'source', entityId: req.params.id, action: 'approve' });
    return one(req.params.id);
  });

  app.post(
    '/sources/:id/status',
    { schema: { params, body: z.object({ status: z.enum(['active', 'paused', 'archived']) }), response: { 200: SourceDto } } },
    async (req) => {
      const staff = requireStaff(req, 'developer');
      const current = await one(req.params.id);
      if (req.body.status === 'active' && !current.approvedAt) throw new AppError(409, 'not_approved', 'אפשר להפעיל רק אתר שהמפתח אישר.');
      await s.db.update(sources).set({ status: req.body.status }).where(eq(sources.id, req.params.id));
      await audit(s.db, { userId: staff.id, entity: 'source', entityId: req.params.id, action: `set_${req.body.status}` });
      return one(req.params.id);
    },
  );
};
