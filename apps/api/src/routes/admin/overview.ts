// Dashboard, learning loop, staff, social accounts, authors.
import {
  AuthorDto,
  ChangePasswordInput,
  CreateSocialAccountInput,
  CreateStaffInput,
  DashboardDto,
  LINK_IN_FIRST_COMMENT,
  LearningOverview,
  SocialAccountDto,
  StaffUserDto,
  UpdateStaffInput,
} from '@b4/shared';
import {
  and,
  articleDrafts,
  articles,
  asc,
  authors,
  comments,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  jobs,
  magazines,
  ne,
  scrapeRuns,
  sessions,
  socialAccounts,
  sources,
  sql,
  users,
} from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../../errors';
import { audit } from '../../lib/audit';
import { newToken } from '../../lib/crypto';
import { hashPassword, verifyPassword } from '../../lib/password';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { activateProfile, learningOverview, queueDistill, saveRules } from '../../services/learning';
import { socialAccountDto } from './settings';

const params = z.object({ id: z.string().uuid() });
const count = sql<number>`count(*)::int`;

export const overviewRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/dashboard', { schema: { response: { 200: DashboardDto } } }, async () => {
    const draftCounts = await s.db.select({ status: articleDrafts.status, n: count }).from(articleDrafts).groupBy(articleDrafts.status);
    const by = (...st: string[]) => draftCounts.filter((d) => st.includes(d.status)).reduce((sum, d) => sum + d.n, 0);
    const [mags] = await s.db.select({ n: count }).from(magazines).where(inArray(magazines.status, ['draft', 'editing', 'ready', 'partially_failed']));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [today] = await s.db.select({ n: count }).from(articles).where(gte(articles.publishedAt, startOfDay));
    const sourceCounts = await s.db.select({ status: sources.status, n: count }).from(sources).groupBy(sources.status);
    const src = (...st: string[]) => sourceCounts.filter((x) => st.includes(x.status)).reduce((sum, x) => sum + x.n, 0);
    const [toReview] = await s.db.select({ n: count }).from(comments).where(and(eq(comments.status, 'hidden'), isNull(comments.moderatedBy)));
    const [reported] = await s.db.select({ n: count }).from(comments).where(and(gt(comments.reportCount, 0), eq(comments.status, 'visible')));
    const [failed] = await s.db.select({ n: count }).from(jobs).where(and(eq(jobs.status, 'failed'), gte(jobs.createdAt, new Date(Date.now() - 86_400_000))));
    const [last] = await s.db.select({ id: scrapeRuns.id }).from(scrapeRuns).orderBy(desc(scrapeRuns.createdAt)).limit(1);
    let lastRun = null;
    if (last) {
      const [run] = await s.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, last.id));
      lastRun = run
        ? {
            id: run.id,
            trigger: run.trigger,
            status: run.status,
            triggeredBy: null,
            startedAt: run.startedAt?.toISOString() ?? null,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            itemsFound: run.itemsFound,
            itemsNew: run.itemsNew,
            createdAt: run.createdAt.toISOString(),
            sources: [],
          }
        : null;
    }
    return {
      drafts: { working: by('queued_ai', 'ai_processing', 'editing'), ready: by('text_final', 'ready'), aiFailed: by('ai_failed') },
      magazinesOpen: mags?.n ?? 0,
      publishedToday: today?.n ?? 0,
      lastRun,
      sources: { active: src('active'), waitingForDeveloper: src('pending_dev', 'in_development'), broken: src('broken') },
      comments: { toReview: toReview?.n ?? 0, reported: reported?.n ?? 0 },
      failedJobs: failed?.n ?? 0,
      ai: await s.ai.status(),
    };
  });

  // --- Learning loop -----------------------------------------------------------
  app.get('/learning', { schema: { response: { 200: LearningOverview } } }, async () => learningOverview(s));

  app.post('/learning/distill', { schema: { response: { 202: z.object({ jobId: z.string().uuid().nullable() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send({ jobId: await queueDistill(s, staff.id, true) });
  });

  app.post('/learning/profiles/:id/activate', { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await activateProfile(s, staff.id, req.params.id);
    await audit(s.db, { userId: staff.id, entity: 'style_profile', entityId: String(req.params.id), action: 'activate' });
    return reply.status(204).send();
  });

  app.put('/learning/rules', { schema: { body: z.object({ rules: z.string().trim().min(10).max(6000) }) } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await saveRules(s, staff.id, req.body.rules);
    await audit(s.db, { userId: staff.id, entity: 'style_profile', entityId: 'manual', action: 'edit' });
    return reply.status(204).send();
  });

  // --- Authors (bylines) ------------------------------------------------------
  app.get('/authors', { schema: { response: { 200: z.array(AuthorDto) } } }, async () =>
    s.db.select({ id: authors.id, displayName: authors.displayName, title: authors.title }).from(authors).orderBy(asc(authors.displayName)),
  );

  // --- Social accounts (admin) ---------------------------------------------------
  const accountDto = (a: typeof socialAccounts.$inferSelect) => socialAccountDto(s, a);

  app.get('/social-accounts', { schema: { response: { 200: z.array(SocialAccountDto) } } }, async () =>
    Promise.all((await s.db.select().from(socialAccounts).orderBy(asc(socialAccounts.platform))).map(accountDto)),
  );

  app.post('/social-accounts', { schema: { body: CreateSocialAccountInput, response: { 201: SocialAccountDto } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const [row] = await s.db
      .insert(socialAccounts)
      .values({ ...req.body, linkInFirstComment: LINK_IN_FIRST_COMMENT[req.body.platform] })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError(409, 'duplicate', 'החשבון הזה כבר קיים.');
    await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: row.id, action: 'create' });
    return reply.status(201).send(await accountDto(row));
  });

  app.patch('/social-accounts/:id', { schema: { params, body: z.object({ isActive: z.boolean() }), response: { 200: SocialAccountDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const [row] = await s.db.update(socialAccounts).set({ isActive: req.body.isActive }).where(eq(socialAccounts.id, req.params.id)).returning();
    if (!row) throw errors.notFound('החשבון');
    await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: row.id, action: req.body.isActive ? 'enable' : 'disable' });
    return accountDto(row);
  });

  // --- Staff (admin) -----------------------------------------------------------
  const staffDto = (u: typeof users.$inferSelect) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });

  app.get('/users', { schema: { response: { 200: z.array(StaffUserDto) } } }, async (req) => {
    requireStaff(req, 'admin');
    return (await s.db.select().from(users).orderBy(asc(users.fullName))).map(staffDto);
  });

  app.post('/users', { schema: { body: CreateStaffInput, response: { 201: z.object({ user: StaffUserDto, temporaryPassword: z.string() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const temporaryPassword = newToken().slice(0, 16);
    const [row] = await s.db
      .insert(users)
      .values({ ...req.body, passwordHash: await hashPassword(temporaryPassword) })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (!row) throw new AppError(409, 'duplicate', 'כבר יש משתמש עם המייל הזה.');
    await audit(s.db, { userId: staff.id, entity: 'user', entityId: row.id, action: 'create', details: { role: row.role } });
    reply.header('cache-control', 'no-store');
    return reply.status(201).send({ user: staffDto(row), temporaryPassword });
  });

  app.patch('/users/:id', { schema: { params, body: UpdateStaffInput, response: { 200: StaffUserDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    if (req.params.id === staff.id && (req.body.isActive === false || (req.body.role && req.body.role !== 'admin'))) {
      throw new AppError(409, 'self_lockout', 'אי אפשר להוריד לעצמך הרשאות ניהול או לחסום את עצמך.');
    }
    const [row] = await s.db.update(users).set(req.body).where(eq(users.id, req.params.id)).returning();
    if (!row) throw errors.notFound('המשתמש');
    if (req.body.isActive === false || req.body.role) await s.db.delete(sessions).where(and(eq(sessions.userId, row.id), ne(sessions.id, staff.sessionId)));
    await audit(s.db, { userId: staff.id, entity: 'user', entityId: row.id, action: 'update', details: req.body });
    return staffDto(row);
  });

  app.post('/users/:id/reset-password', { schema: { params, response: { 200: z.object({ temporaryPassword: z.string() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    const temporaryPassword = newToken().slice(0, 16);
    const [row] = await s.db.update(users).set({ passwordHash: await hashPassword(temporaryPassword) }).where(eq(users.id, req.params.id)).returning({ id: users.id });
    if (!row) throw errors.notFound('המשתמש');
    await s.db.delete(sessions).where(eq(sessions.userId, row.id));
    await audit(s.db, { userId: staff.id, entity: 'user', entityId: row.id, action: 'reset_password' });
    reply.header('cache-control', 'no-store');
    return { temporaryPassword };
  });

  app.post('/me/password', { schema: { body: ChangePasswordInput }, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const staff = requireStaff(req);
    const [me] = await s.db.select().from(users).where(eq(users.id, staff.id)).limit(1);
    if (!me || !(await verifyPassword(me.passwordHash, req.body.current))) throw new AppError(400, 'bad_password', 'הסיסמה הנוכחית שגויה');
    await s.db.update(users).set({ passwordHash: await hashPassword(req.body.next) }).where(eq(users.id, staff.id));
    // Sign out every other device.
    await s.db.delete(sessions).where(and(eq(sessions.userId, staff.id), ne(sessions.id, staff.sessionId)));
    await audit(s.db, { userId: staff.id, entity: 'user', entityId: staff.id, action: 'change_password' });
    return reply.status(204).send();
  });
};
