import { mkdirSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { Db } from '@b4/db';
import Fastify, { type FastifyError } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config';
import { sampleSites } from './dev/sample-sites';
import { AppError } from './errors';
import type { Mailer } from './lib/mailer';
import type { MediaStorage } from './lib/storage';
import { authPlugin } from './plugins/auth';
import { securityPlugin } from './plugins/security';
import { adminRoutes } from './routes/admin';
import { publicAdRoutes } from './routes/ads';
import { audienceRoutes } from './routes/audience';
import { commentRoutes, publicCommentRoutes } from './routes/comments';
import { contentRoutes } from './routes/content';
import { readerAuthRoutes } from './routes/reader-auth';
import { siteRoutes } from './routes/site';
import { staffAuthRoutes } from './routes/staff-auth';
import { publicTakedownRoutes } from './routes/takedowns';
import type { AiHub } from './services/ai';
import { type Services, createServices } from './services/context';
import type { Fetcher } from './services/scraper/collect';

export type AppDeps = {
  config: Config;
  db: Db;
  /** Default: the SMTP server configured in the CMS (or SMTP_URL). */
  mailer?: Mailer;
  logger?: boolean;
  /** Overrides for tests; production builds these from the config. */
  storage?: MediaStorage;
  ai?: AiHub;
  fetch?: Fetcher;
};

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

export async function buildApp({ config, db, logger = true, ...overrides }: AppDeps) {
  const app = Fastify({
    logger: logger ? { level: 'info' } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Every error leaves as { code, message }, with a message safe to show the reader.
  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      const extra = error as AppError & { retryAfter?: number; version?: number };
      if (extra.retryAfter) reply.header('retry-after', extra.retryAfter);
      return reply.status(error.statusCode).send({ code: error.code, message: error.message, ...(extra.version ? { version: extra.version } : {}) });
    }
    if (error.validation) {
      const fields: Record<string, string> = {};
      for (const issue of error.validation) {
        const key = issue.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'body';
        fields[key] ??= issue.message ?? 'ערך לא תקין';
      }
      const first = Object.values(fields)[0];
      return reply.status(400).send({ code: 'validation', message: first ?? 'הנתונים שנשלחו לא תקינים', fields });
    }
    if (error.statusCode === 413) return reply.status(413).send({ code: 'too_large', message: 'הבקשה גדולה מדי' });
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ code: error.code ?? 'bad_request', message: 'הבקשה לא תקינה' });
    }
    req.log.error(error);
    return reply.status(500).send({ code: 'internal', message: 'משהו השתבש אצלנו. נסו שוב בעוד רגע.' });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ code: 'not_found', message: 'הכתובת לא נמצאה' }));

  const services: Services = createServices(config, db, app.log, overrides);
  const { mailer } = services;
  app.decorate('services', services);

  await app.register(securityPlugin, { config });
  await app.register(authPlugin, { db });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  // Local media files (in the cloud they live in the bucket, at MEDIA_BASE_URL, and this route isn't needed).
  if (!overrides.storage && !config.mediaBucket) {
    mkdirSync(config.mediaDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: config.mediaDir,
      prefix: '/media/',
      decorateReply: false,
      immutable: true,
      maxAge: '365d',
      // Images are embedded by the site, the app and the CMS on other origins.
      setHeaders: (reply) => void reply.header('cross-origin-resource-policy', 'cross-origin'),
    });
  }

  if (config.devFixtures) await app.register(sampleSites, { prefix: '/dev/sites', publicApiUrl: config.publicApiUrl });

  await app.register(
    async (v1) => {
      await v1.register(contentRoutes, { prefix: '/public', db, config });
      await v1.register(siteRoutes, { prefix: '/public', s: services });
      await v1.register(publicCommentRoutes, { prefix: '/public', db });
      await v1.register(audienceRoutes, { prefix: '/public', s: services });
      await v1.register(publicTakedownRoutes, { prefix: '/public', s: services });
      await v1.register(publicAdRoutes, { prefix: '/public', s: services });
      await v1.register(commentRoutes, { s: services });
      await v1.register(readerAuthRoutes, { prefix: '/auth/reader', s: services });
      await v1.register(staffAuthRoutes, { prefix: '/auth/staff', db, config });
      await v1.register(adminRoutes, { prefix: '/admin', s: services });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
