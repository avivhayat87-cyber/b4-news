// Transport-level protections: security headers, CORS allowlist, rate limits,
// and a cross-site request check for cookie-authenticated writes.
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config';
import { AppError } from '../errors';

export const COOKIE = { reader: 'b4_rs', staff: 'b4_ss' } as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const securityPlugin = fp(async (app: FastifyInstance, opts: { config: Config }) => {
  const { config } = opts;

  await app.register(helmet, {
    // JSON API: no inline content, never framed, never sniffed.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key'],
    maxAge: 600,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    // After the auth hook, so per-reader limits can key on the signed-in reader.
    hook: 'preHandler',
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError(429, 'rate_limited', 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.');
      (err as AppError & { retryAfter?: number }).retryAfter = Math.ceil(ctx.ttl / 1000);
      return err;
    },
  });

  // Cookie-authenticated writes must come from an allowed origin (CSRF protection).
  // Bearer-token clients (the mobile app) are exempt: browsers never attach those automatically.
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    const usesCookie = Boolean(req.cookies[COOKIE.reader] || req.cookies[COOKIE.staff]);
    if (!usesCookie || req.headers.authorization) return;
    const origin = req.headers.origin;
    if (!origin || !config.corsOrigins.includes(origin)) {
      throw new AppError(403, 'bad_origin', 'הבקשה נחסמה מסיבות אבטחה. רעננו את הדף ונסו שוב.');
    }
  });
});
