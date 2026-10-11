import type { Db } from '@b4/db';
import Fastify, { type FastifyError } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config';
import { AppError } from './errors';
import type { Mailer } from './lib/mailer';
import { authPlugin } from './plugins/auth';
import { securityPlugin } from './plugins/security';
import { adminCommentRoutes } from './routes/admin-comments';
import { audienceRoutes } from './routes/audience';
import { commentRoutes, publicCommentRoutes } from './routes/comments';
import { contentRoutes } from './routes/content';
import { readerAuthRoutes } from './routes/reader-auth';
import { staffAuthRoutes } from './routes/staff-auth';

export type AppDeps = { config: Config; db: Db; mailer: Mailer; logger?: boolean };

export async function buildApp({ config, db, mailer, logger = true }: AppDeps) {
  const app = Fastify({
    logger: logger ? { level: config.production ? 'info' : 'info' } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Every error leaves as { code, message }, with a message safe to show the reader.
  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      const retryAfter = (error as AppError & { retryAfter?: number }).retryAfter;
      if (retryAfter) reply.header('retry-after', retryAfter);
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
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
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ code: error.code ?? 'bad_request', message: 'הבקשה לא תקינה' });
    }
    req.log.error(error);
    return reply.status(500).send({ code: 'internal', message: 'משהו השתבש אצלנו. נסו שוב בעוד רגע.' });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ code: 'not_found', message: 'הכתובת לא נמצאה' }));

  await app.register(securityPlugin, { config });
  await app.register(authPlugin, { db });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      await v1.register(contentRoutes, { prefix: '/public', db, config });
      await v1.register(publicCommentRoutes, { prefix: '/public', db });
      await v1.register(audienceRoutes, { prefix: '/public', db, config, mailer });
      await v1.register(commentRoutes, { db });
      await v1.register(readerAuthRoutes, { prefix: '/auth/reader', db, config, mailer });
      await v1.register(staffAuthRoutes, { prefix: '/auth/staff', db, config });
      await v1.register(adminCommentRoutes, { prefix: '/admin', db });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
