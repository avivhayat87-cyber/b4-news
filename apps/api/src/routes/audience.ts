// Newsletter sign-up (double opt-in, with the terms accepted) and unsubscribe,
// the consent banner's answer, push-notification devices, and the count of reads: /api/v1/public/*
import { ArticleReadInput, DigestPrefs, NewsletterSignupInput, UnsubscribeInput, VisitorConsentInput } from '@b4/shared';
import { and, devices, eq, isNull, newsletterSubscribers, sql } from '@b4/db';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { newToken, sha256 } from '../lib/crypto';
import { recordConsent } from '../services/consent';
import type { Services } from '../services/context';
import { saveSubscriberDigest, stopReaderDigestMail, subscriberDigest } from '../services/digest';
import { unsubscribeToken, validUnsubscribeToken } from '../services/newsletter';
import { stopMails } from '../services/notifications';
import { recordRead } from '../services/reads';
import { legalVersion } from '../services/site-settings';

export const audienceRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  const { db, config, mailer } = s;

  // One read of an article (services/reads.ts): numbers only, nothing about the reader.
  app.post('/reads', { schema: { body: ArticleReadInput }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    await recordRead(s, req.body.articleId, req.body.from);
    return reply.header('cache-control', 'no-store').status(204).send();
  });

  app.post(
    '/newsletter',
    { schema: { body: NewsletterSignupInput }, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const token = newToken();
      const [row] = await db
        .insert(newsletterSubscribers)
        .values({ email: req.body.email, confirmTokenHash: sha256(token) })
        // Someone who unsubscribed signs up again through the same confirmation link
        // (their removal stays on record until they confirm).
        .onConflictDoUpdate({
          target: newsletterSubscribers.email,
          set: { confirmTokenHash: sha256(token), confirmedAt: null },
          setWhere: sql`${newsletterSubscribers.confirmedAt} is null or ${newsletterSubscribers.unsubscribedAt} is not null`,
        })
        .returning({ id: newsletterSubscribers.id });
      // Active subscribers get no new mail; the answer is the same either way.
      if (row) {
        await recordConsent(db, config.hashPepper, {
          subject: 'subscriber',
          subscriberId: row.id,
          termsVersion: await legalVersion(s),
          channel: 'web',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
        const link = `${config.publicSiteUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`;
        await mailer.send({
          to: req.body.email,
          subject: "אישור הרשמה לניוזלטר של B4 NEW'S",
          text: `כדי להתחיל לקבל את הניוזלטר, אשרו את ההרשמה בקישור:\n${link}\n\nאם לא נרשמתם, אפשר להתעלם מההודעה.`,
        });
      }
      return reply.status(202).send();
    },
  );

  app.post(
    '/newsletter/confirm',
    {
      schema: { body: z.object({ token: z.string().min(20).max(200) }), response: { 200: z.object({ id: z.string().uuid(), token: z.string() }) } },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req) => {
      const [row] = await db
        .update(newsletterSubscribers)
        .set({ confirmedAt: new Date(), confirmTokenHash: null, unsubscribedAt: null })
        .where(eq(newsletterSubscribers.confirmTokenHash, sha256(req.body.token)))
        .returning({ id: newsletterSubscribers.id });
      if (!row) throw new AppError(400, 'token_invalid', 'הקישור לא תקין או שכבר נעשה בו שימוש');
      // Straight on to "העיתון שלי": topics and time, with the same key as every issue's links.
      return { id: row.id, token: unsubscribeToken(config, row.id) };
    },
  );

  const prefsParams = UnsubscribeInput;
  app.get('/newsletter/preferences/:id/:token', { schema: { params: prefsParams, response: { 200: DigestPrefs } } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return subscriberDigest(s, req.params.id, req.params.token);
  });
  app.put(
    '/newsletter/preferences/:id/:token',
    { schema: { params: prefsParams, body: DigestPrefs, response: { 200: DigestPrefs } }, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req) => saveSubscriberDigest(s, req.params.id, req.params.token, req.body),
  );

  const unsubscribe = async (id: string, token: string) => {
    if (!validUnsubscribeToken(config, id, token)) throw new AppError(400, 'token_invalid', 'קישור ההסרה לא תקין');
    // The row stays, with the time of the removal, as the record the law asks for.
    await db
      .update(newsletterSubscribers)
      .set({ unsubscribedAt: new Date() })
      .where(and(eq(newsletterSubscribers.id, id), isNull(newsletterSubscribers.unsubscribedAt)));
  };

  // From the unsubscribe page on the site.
  app.post('/newsletter/unsubscribe', { schema: { body: UnsubscribeInput }, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    await unsubscribe(req.body.id, req.body.token);
    return reply.status(204).send();
  });

  // One-click unsubscribe from the mail client (RFC 8058): a form POST to the List-Unsubscribe address.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/newsletter/unsubscribe/:id/:token',
      { schema: { params: UnsubscribeInput }, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
      async (req, reply) => {
        await unsubscribe(req.params.id, req.params.token);
        return reply.status(204).send();
      },
    );
    // A signed-in reader's personal issue by mail.
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/digest/mail-off/:id/:token',
      { schema: { params: UnsubscribeInput }, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
      async (req, reply) => {
        await stopReaderDigestMail(s, req.params.id, req.params.token);
        return reply.status(204).send();
      },
    );
    // The same for the mails about replies and likes.
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/notifications/mail-off/:id/:token',
      { schema: { params: UnsubscribeInput }, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
      async (req, reply) => {
        await stopMails(s, req.params.id, req.params.token);
        return reply.status(204).send();
      },
    );
  });

  // The consent banner (site) and the welcome screen (app). Anonymous: a random id from the browser or device.
  app.post('/consent', { schema: { body: VisitorConsentInput }, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const current = await legalVersion(s);
    if (req.body.version !== current) throw new AppError(409, 'terms_changed', 'התנאים עודכנו. רעננו את הדף ואשרו את הגרסה החדשה.');
    await recordConsent(db, config.hashPepper, {
      subject: 'visitor',
      visitorId: req.body.visitorId,
      termsVersion: current,
      ads: req.body.ads,
      channel: req.body.channel,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return reply.status(204).send();
  });

  const DeviceInput = z.object({
    platform: z.enum(['ios', 'android', 'web']),
    pushToken: z.string().min(10).max(500),
    topics: z.array(z.string().max(50)).max(30).default(['breaking']),
    appVersion: z.string().max(40).optional(),
  });

  app.post(
    '/devices',
    { schema: { body: DeviceInput }, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const { platform, pushToken, topics, appVersion } = req.body;
      // Signed in to the app (its bearer token): replies and likes reach this phone; signed out, they stop.
      const readerId = req.reader?.id ?? null;
      await db
        .insert(devices)
        .values({ platform, pushToken, topics, appVersion, readerId })
        .onConflictDoUpdate({ target: devices.pushToken, set: { platform, topics, appVersion, readerId, lastSeenAt: new Date() } });
      return reply.status(204).send();
    },
  );

  app.delete(
    '/devices/:pushToken',
    { schema: { params: z.object({ pushToken: z.string().min(10).max(500) }) } },
    async (req, reply) => {
      await db.delete(devices).where(eq(devices.pushToken, req.params.pushToken));
      return reply.status(204).send();
    },
  );
};
