// Reader sign-in by one-time email code, or by the one-click link in the same mail:
// /api/v1/auth/reader/*. No passwords to leak; codes and link tokens are hashed,
// short-lived, single-use and attempt-limited. Signing up (and signing in after a new
// terms version) requires accepting the terms, and readers can delete their account themselves.
import {
  AcceptTermsInput,
  DigestPrefs,
  FEED_MODES,
  FeedPage,
  MarkNotificationsInput,
  ReaderDto,
  ReaderLinkSession,
  ReaderNotificationList,
  ReaderPrefs,
  ReaderSession,
  RequestCodeInput,
  UpdateReaderInput,
  VerifyCodeInput,
  VerifyLinkInput,
} from '@b4/shared';
import { and, desc, eq, gt, isNull, loginCodes, readers, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import { keyedHash, newSixDigitCode, newToken, safeEqualHex } from '../lib/crypto';
import { clearSessionCookie, createSession, destroySession, requireReader, setSessionCookie } from '../plugins/auth';
import { recordConsent } from '../services/consent';
import type { Services } from '../services/context';
import { readerDigest, saveReaderDigest } from '../services/digest';
import { feed } from '../services/feed';
import { getPrefs, listNotifications, markRead, setPrefs } from '../services/notifications';
import { completeSignIn, readerDto as dto, signInMail } from '../services/reader-signin';
import { legalVersion } from '../services/site-settings';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_15_MIN = 3;

const invalidCode = () => new AppError(400, 'code_invalid', 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');
const invalidLink = () => new AppError(400, 'link_invalid', 'הקישור כבר שומש או שפג תוקפו. אפשר לבקש קוד חדש.');

export const readerAuthRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  const { db, config, mailer } = s;
  const codeHash = (email: string, code: string) => keyedHash(config.hashPepper, 'login-code', email, code);
  const linkHash = (token: string) => keyedHash(config.hashPepper, 'login-link', token);

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
      const token = newToken();
      await db.insert(loginCodes).values({
        email,
        codeHash: codeHash(email, code),
        linkTokenHash: linkHash(token),
        termsAccepted: req.body.acceptTerms === true,
        returnTo: req.body.returnTo ?? null,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        ipHash: keyedHash(config.hashPepper, 'ip', req.ip),
      });
      // The token travels after "#", so it never reaches a server log or a mail scanner's request.
      await mailer.send(signInMail(email, code, `${config.publicSiteUrl}/signin#t=${token}`));
      // Same answer whether or not the address is registered.
      return reply.status(204).send();
    },
  );

  /** "התחברות בלחיצה": the site's /signin page sends the token from the link (web only: it sets the cookie). */
  app.post(
    '/verify-link',
    {
      schema: { body: VerifyLinkInput, response: { 200: ReaderLinkSession } },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const [pending] = await db
        .select()
        .from(loginCodes)
        .where(and(eq(loginCodes.linkTokenHash, linkHash(req.body.token)), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, sql`now()`)))
        .limit(1);
      if (!pending || pending.attempts >= MAX_ATTEMPTS) throw invalidLink();
      const { readerId, reader } = await completeSignIn(s, {
        email: pending.email,
        displayName: req.body.displayName,
        acceptTerms: req.body.acceptTerms === true || pending.termsAccepted,
        channel: 'web',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        consume: () => db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, pending.id)),
      });
      const session = await createSession(db, { kind: 'reader', readerId }, req.headers['user-agent']);
      reply.header('cache-control', 'no-store');
      setSessionCookie(reply, config, 'reader', session.token, session.expiresAt);
      return { reader, returnTo: pending.returnTo };
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

      const { readerId, reader: out } = await completeSignIn(s, {
        email,
        displayName,
        acceptTerms: acceptTerms === true,
        channel: client,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        consume: () => db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, pending.id)),
      });

      const session = await createSession(db, { kind: 'reader', readerId }, req.headers['user-agent']);
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

  // --- The bell: replies, likes, the editors' pick; and how to hear about them -----------------------
  app.get('/notifications', { schema: { response: { 200: ReaderNotificationList } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return listNotifications(s, requireReader(req).id);
  });

  app.post('/notifications/read', { schema: { body: MarkNotificationsInput } }, async (req, reply) => {
    await markRead(s, requireReader(req).id, req.body.ids);
    return reply.status(204).send();
  });

  app.get('/prefs', { schema: { response: { 200: ReaderPrefs } } }, async (req) => getPrefs(s, requireReader(req).id));

  // --- "הפיד שלי": articles in the reader's topics with the conversation around them ------------------
  app.get(
    '/feed',
    {
      schema: {
        querystring: z.object({ mode: z.enum(FEED_MODES).default('for-you'), cursor: z.string().max(200).optional(), seed: z.coerce.number().int().min(0).max(1_000_000).default(0) }),
        response: { 200: FeedPage },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return feed(db, config, requireReader(req).id, req.query.mode, req.query.cursor, req.query.seed);
    },
  );

  // --- "העיתון שלי": topics (also the feed), the hour, mail and/or phone ------------------------------
  app.get('/digest', { schema: { response: { 200: DigestPrefs } } }, async (req) => readerDigest(s, requireReader(req).id));

  app.put('/digest', { schema: { body: DigestPrefs, response: { 200: DigestPrefs } } }, async (req) => saveReaderDigest(s, requireReader(req).id, req.body));

  app.put('/prefs', { schema: { body: ReaderPrefs, response: { 200: ReaderPrefs } } }, async (req) => setPrefs(s, requireReader(req).id, req.body));

  app.post('/logout', async (req, reply) => {
    if (req.reader) await destroySession(db, req.reader.sessionId);
    clearSessionCookie(reply, config, 'reader');
    return reply.status(204).send();
  });
};
