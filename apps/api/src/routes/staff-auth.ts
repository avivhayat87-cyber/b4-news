// Newsroom staff sign-in for the CMS: /api/v1/auth/staff/*
// The password first; with two-step sign-in on (or required by the newsroom), a code from an
// authenticator app next, tied to that password check by a short-lived challenge.
import { StaffChallengeInput, StaffDto, StaffLoginInput, StaffLoginResult, StaffTwoFactorInput, StaffTwoFactorResult, TwoFactorSetupDto } from '@b4/shared';
import { type Db, eq, users } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import { audit } from '../lib/audit';
import { verifyPassword } from '../lib/password';
import { clearSessionCookie, createSession, destroySession, requireStaff, setSessionCookie } from '../plugins/auth';
import { badCode, challengeUser, checkCode, enable, endChallenge, failedTry, getSecurity, startChallenge, startSetup } from '../services/two-factor';

export const staffAuthRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const dto = (u: { id: string; email: string; fullName: string; role: StaffDto['role'] }): StaffDto => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role });

  async function signIn(reply: Parameters<typeof setSessionCookie>[0], user: typeof users.$inferSelect, userAgent: string | undefined, twoFactor: boolean) {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const session = await createSession(db, { kind: 'staff', userId: user.id }, userAgent);
    setSessionCookie(reply, config, 'staff', session.token, session.expiresAt);
    await audit(db, { userId: user.id, entity: 'user', entityId: user.id, action: 'login', details: { twoFactor } });
    reply.header('cache-control', 'no-store');
  }

  app.post(
    '/login',
    {
      schema: { body: StaffLoginInput, response: { 200: StaffLoginResult } },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = await verifyPassword(user?.passwordHash, password);
      if (!user || !ok || !user.isActive) {
        throw new AppError(401, 'bad_credentials', 'המייל או הסיסמה שגויים');
      }
      reply.header('cache-control', 'no-store');
      if (user.totpEnabledAt || (await getSecurity(db)).requireTwoFactor) {
        return { staff: null, twoFactor: user.totpEnabledAt ? ('code' as const) : ('setup' as const), challenge: await startChallenge(db, user.id) };
      }
      await signIn(reply, user, req.headers['user-agent'], false);
      return { staff: dto(user), twoFactor: null, challenge: null };
    },
  );

  /** Required but not set up yet: the QR code to scan, during sign-in. */
  app.post(
    '/login/2fa-setup',
    { schema: { body: StaffChallengeInput, response: { 200: TwoFactorSetupDto } }, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { user } = await challengeUser(db, req.body.challenge);
      reply.header('cache-control', 'no-store');
      return startSetup({ db, config }, user);
    },
  );

  /** The code from the app (or a recovery code); right after a setup, the recovery codes come back once. */
  app.post(
    '/login/2fa',
    { schema: { body: StaffTwoFactorInput, response: { 200: StaffTwoFactorResult } }, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const c = { db, config };
      const { id, user } = await challengeUser(db, req.body.challenge);
      let recoveryCodes: string[] | null = null;
      try {
        if (user.totpEnabledAt) {
          if (!(await checkCode(c, user, req.body.code))) throw badCode();
        } else {
          recoveryCodes = await enable(c, user, req.body.code);
        }
      } catch (e) {
        await failedTry(db, id);
        throw e;
      }
      await endChallenge(db, id);
      await signIn(reply, user, req.headers['user-agent'], true);
      return { staff: dto(user), recoveryCodes };
    },
  );

  app.get('/me', { schema: { response: { 200: StaffDto } } }, async (req, reply) => {
    const staff = requireStaff(req);
    reply.header('cache-control', 'no-store');
    return { id: staff.id, email: staff.email, fullName: staff.fullName, role: staff.role };
  });

  app.post('/logout', async (req, reply) => {
    if (req.staff) await destroySession(db, req.staff.sessionId);
    clearSessionCookie(reply, config, 'staff');
    return reply.status(204).send();
  });
};
