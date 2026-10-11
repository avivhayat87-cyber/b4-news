// Newsroom staff sign-in for the CMS: /api/v1/auth/staff/*
import { StaffDto, StaffLoginInput } from '@b4/shared';
import { type Db, eq, users } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import { audit } from '../lib/audit';
import { verifyPassword } from '../lib/password';
import { clearSessionCookie, createSession, destroySession, requireStaff, setSessionCookie } from '../plugins/auth';

export const staffAuthRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  app.post(
    '/login',
    {
      schema: { body: StaffLoginInput, response: { 200: StaffDto } },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = await verifyPassword(user?.passwordHash, password);
      if (!user || !ok || !user.isActive) {
        throw new AppError(401, 'bad_credentials', 'המייל או הסיסמה שגויים');
      }
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const session = await createSession(db, { kind: 'staff', userId: user.id }, req.headers['user-agent']);
      setSessionCookie(reply, config, 'staff', session.token, session.expiresAt);
      await audit(db, { userId: user.id, entity: 'user', entityId: user.id, action: 'login' });
      reply.header('cache-control', 'no-store');
      return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
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
