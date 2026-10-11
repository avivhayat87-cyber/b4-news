// Reader sign-in by one-time email code: /api/v1/auth/reader/*
// No passwords to leak; codes are hashed, short-lived, single-use and attempt-limited.
import { ReaderDto, ReaderSession, RequestCodeInput, UpdateReaderInput, VerifyCodeInput } from '@b4/shared';
import { type Db, and, desc, eq, gt, isNull, loginCodes, readers, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import { AppError, errors } from '../errors';
import { keyedHash, newSixDigitCode, safeEqualHex } from '../lib/crypto';
import type { Mailer } from '../lib/mailer';
import { clearSessionCookie, createSession, destroySession, requireReader, setSessionCookie } from '../plugins/auth';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_15_MIN = 3;

const invalidCode = () => new AppError(400, 'code_invalid', 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');

export const readerAuthRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; mailer: Mailer }> = async (app, { db, config, mailer }) => {
  const codeHash = (email: string, code: string) => keyedHash(config.hashPepper, 'login-code', email, code);

  app.post(
    '/request-code',
    {
      schema: { body: RequestCodeInput },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { email } = req.body;
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(loginCodes)
        .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, sql`now() - interval '15 minutes'`)));
      if ((recent?.n ?? 0) >= MAX_CODES_PER_EMAIL_15_MIN) throw errors.rateLimited();

      const code = newSixDigitCode();
      await db.insert(loginCodes).values({
        email,
        codeHash: codeHash(email, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        ipHash: keyedHash(config.hashPepper, 'ip', req.ip),
      });
      await mailer.send({
        to: email,
        subject: `הקוד שלך ל-B4 NEW'S: ${code}`,
        text: `הקוד להתחברות הוא ${code}\n\nהקוד בתוקף ל-10 דקות. אם לא ביקשת להתחבר, אפשר להתעלם מההודעה.`,
      });
      // Same answer whether or not the address is registered.
      return reply.status(204).send();
    },
  );

  app.post(
    '/verify',
    {
      schema: { body: VerifyCodeInput, response: { 200: ReaderSession } },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { email, code, displayName, client } = req.body;
      const [pending] = await db
        .select()
        .from(loginCodes)
        .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, sql`now()`)))
        .orderBy(desc(loginCodes.createdAt))
        .limit(1);
      if (!pending || pending.attempts >= MAX_ATTEMPTS) throw invalidCode();

      if (!safeEqualHex(pending.codeHash, codeHash(email, code))) {
        const attempts = pending.attempts + 1;
        await db
          .update(loginCodes)
          .set({ attempts, consumedAt: attempts >= MAX_ATTEMPTS ? new Date() : null })
          .where(eq(loginCodes.id, pending.id));
        throw invalidCode();
      }

      let [reader] = await db.select().from(readers).where(eq(readers.email, email)).limit(1);
      if (!reader && !displayName) {
        // Code is right but this is a first sign-in: ask for a display name, keep the code valid.
        throw new AppError(409, 'name_required', 'נשאר רק לבחור שם שיופיע ליד התגובות שלך');
      }
      await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, pending.id));

      if (!reader) {
        [reader] = await db.insert(readers).values({ email, displayName: displayName! }).returning();
      }
      if (!reader) throw new Error('reader insert failed');
      if (reader.status === 'banned') throw errors.banned();
      await db.update(readers).set({ lastLoginAt: new Date() }).where(eq(readers.id, reader.id));

      const session = await createSession(db, { kind: 'reader', readerId: reader.id }, req.headers['user-agent']);
      const dto = { id: reader.id, email: reader.email, displayName: reader.displayName };
      reply.header('cache-control', 'no-store');
      if (client === 'app') return { reader: dto, token: session.token };
      setSessionCookie(reply, config, 'reader', session.token, session.expiresAt);
      return { reader: dto };
    },
  );

  app.get('/me', { schema: { response: { 200: ReaderDto } } }, async (req, reply) => {
    const reader = requireReader(req);
    reply.header('cache-control', 'no-store');
    return { id: reader.id, email: reader.email, displayName: reader.displayName };
  });

  app.patch('/me', { schema: { body: UpdateReaderInput, response: { 200: ReaderDto } } }, async (req) => {
    const reader = requireReader(req);
    await db.update(readers).set({ displayName: req.body.displayName }).where(eq(readers.id, reader.id));
    return { id: reader.id, email: reader.email, displayName: req.body.displayName };
  });

  app.post('/logout', async (req, reply) => {
    if (req.reader) await destroySession(db, req.reader.sessionId);
    clearSessionCookie(reply, config, 'reader');
    return reply.status(204).send();
  });
};
