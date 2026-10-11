// Newsletter sign-up (double opt-in) and push-notification devices: /api/v1/public/*
import { Email } from '@b4/shared';
import { type Db, devices, eq, newsletterSubscribers, sql } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import { newToken, sha256 } from '../lib/crypto';
import type { Mailer } from '../lib/mailer';

export const audienceRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; mailer: Mailer }> = async (app, { db, config, mailer }) => {
  app.post(
    '/newsletter',
    { schema: { body: z.object({ email: Email }) }, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const token = newToken();
      const [row] = await db
        .insert(newsletterSubscribers)
        .values({ email: req.body.email, confirmTokenHash: sha256(token) })
        .onConflictDoUpdate({
          target: newsletterSubscribers.email,
          set: { confirmTokenHash: sha256(token), unsubscribedAt: null },
          setWhere: sql`${newsletterSubscribers.confirmedAt} is null`,
        })
        .returning({ id: newsletterSubscribers.id });
      // Already confirmed addresses get no new mail; the answer is the same either way.
      if (row) {
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
    { schema: { body: z.object({ token: z.string().min(20).max(200) }) }, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const [row] = await db
        .update(newsletterSubscribers)
        .set({ confirmedAt: new Date(), confirmTokenHash: null })
        .where(eq(newsletterSubscribers.confirmTokenHash, sha256(req.body.token)))
        .returning({ id: newsletterSubscribers.id });
      if (!row) throw new AppError(400, 'token_invalid', 'הקישור לא תקין או שכבר נעשה בו שימוש');
      return reply.status(204).send();
    },
  );

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
      await db
        .insert(devices)
        .values({ platform, pushToken, topics, appVersion })
        .onConflictDoUpdate({ target: devices.pushToken, set: { platform, topics, appVersion, lastSeenAt: new Date() } });
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
