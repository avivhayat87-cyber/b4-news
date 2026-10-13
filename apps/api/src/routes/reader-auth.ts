// Reader sign-in by one-time email code: /api/v1/auth/reader/*
// No passwords to leak; codes are hashed, short-lived, single-use and attempt-limited.
// Signing up (and signing in after a new terms version) requires accepting the terms,
// and readers can delete their account themselves.
import { AcceptTermsInput, ReaderDto, ReaderSession, RequestCodeInput, UpdateReaderInput, VerifyCodeInput } from '@b4/shared';
import { and, desc, eq, gt, isNull, loginCodes, readers, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import { keyedHash, newSixDigitCode, safeEqualHex } from '../lib/crypto';
import { clearSessionCookie, createSession, destroySession, requireReader, setSessionCookie } from '../plugins/auth';
import { recordConsent } from '../services/consent';
import type { Services } from '../services/context';
import { legalVersion } from '../services/site-settings';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_15_MIN = 3;

const invalidCode = () => new AppError(400, 'code_invalid', 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');

const dto = (r: { id: string; email: string; displayName: string; termsVersion: string | null }, version: string): ReaderDto => ({
  id: r.id,
  email: r.email,
  displayName: r.displayName,
  termsAccepted: r.termsVersion === version,
});

export const readerAuthRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  const { db, config, mailer } = s;
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
      const { email, code, displayName, acceptTerms, client } = req.body;
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
      // New readers, and readers who accepted an older version, accept the current terms.
      const version = await legalVersion(s);
      const accepting = !reader || reader.termsVersion !== version;
      if (accepting && !acceptTerms) throw errors.termsRequired();
      await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, pending.id));

      if (!reader) {
        [reader] = await db.insert(readers).values({ email, displayName: displayName! }).returning();
      }
      if (!reader) throw new Error('reader insert failed');
      if (reader.status === 'banned') throw errors.banned();
      const now = new Date();
      await db
        .update(readers)
        .set({ lastLoginAt: now, ...(accepting ? { termsVersion: version, termsAcceptedAt: now } : {}) })
        .where(eq(readers.id, reader.id));
      if (accepting) {
        await recordConsent(db, config.hashPepper, {
          subject: 'reader',
          readerId: reader.id,
          termsVersion: version,
          channel: client,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      const session = await createSession(db, { kind: 'reader', readerId: reader.id }, req.headers['user-agent']);
      const out = dto({ ...reader, termsVersion: accepting ? version : reader.termsVersion }, version);
      reply.header('cache-control', 'no-store');
      if (client === 'app') return { reader: out, token: session.token };
      setSessionCookie(reply, config, 'reader', session.token, session.expiresAt);
      return { reader: out };
    },
  );

  // For the site: always 200, `reader: null` when signed out (no noisy 401 in the browser console).
  app.get('/session', { schema: { response: { 200: z.object({ reader: ReaderDto.nullable() }) } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const r = req.reader;
    return { reader: r && !r.banned ? dto(r, await legalVersion(s)) : null };
  });

  app.get('/me', { schema: { response: { 200: ReaderDto } } }, async (req, reply) => {
    const reader = requireReader(req);
    reply.header('cache-control', 'no-store');
    return dto(reader, await legalVersion(s));
  });

  app.patch('/me', { schema: { body: UpdateReaderInput, response: { 200: ReaderDto } } }, async (req) => {
    const reader = requireReader(req);
    await db.update(readers).set({ displayName: req.body.displayName }).where(eq(readers.id, reader.id));
    return dto({ ...reader, displayName: req.body.displayName }, await legalVersion(s));
  });

  /** A signed-in reader accepts a new version of the terms (asked before their next comment). */
  app.post('/terms', { schema: { body: AcceptTermsInput, response: { 200: ReaderDto } } }, async (req) => {
    const reader = requireReader(req);
    const version = await legalVersion(s);
    if (req.body.version !== version) throw new AppError(409, 'terms_changed', 'התנאים עודכנו שוב. רעננו את הדף ואשרו את הגרסה החדשה.');
    await db.update(readers).set({ termsVersion: version, termsAcceptedAt: new Date() }).where(eq(readers.id, reader.id));
    await recordConsent(db, config.hashPepper, {
      subject: 'reader',
      readerId: reader.id,
      termsVersion: version,
      channel: req.headers.authorization ? 'app' : 'web',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return dto({ ...reader, termsVersion: version }, version);
  });

  /**
   * Deletes the account and everything tied to it: comments and their replies, reports,
   * sessions, consent records and pending sign-in codes. Banned readers may delete too.
   */
  app.delete('/me', async (req, reply) => {
    const reader = req.reader;
    if (!reader) throw errors.authRequired();
    await db.transaction(async (tx) => {
      await tx.delete(loginCodes).where(eq(loginCodes.email, reader.email));
      await tx.delete(readers).where(eq(readers.id, reader.id));
    });
    // No personal details in the log, only that an account was deleted.
    await audit(db, { entity: 'reader', entityId: reader.id, action: 'self_delete' });
    clearSessionCookie(reply, config, 'reader');
    return reply.status(204).send();
  });

  app.post('/logout', async (req, reply) => {
    if (req.reader) await destroySession(db, req.reader.sessionId);
    clearSessionCookie(reply, config, 'reader');
    return reply.status(204).send();
  });
};
