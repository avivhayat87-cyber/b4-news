import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', ''])
    .default(fallback ? 'true' : 'false')
    .transform((v) => (v === '' ? fallback : v === 'true'));

const DEV_PEPPER = 'local-development-pepper-not-secret';

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().optional(),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
    PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
    COOKIE_DOMAIN: z.string().optional(),
    HASH_PEPPER: z.string().optional(),
    MEDIA_BASE_URL: z.string().default(''),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("B4 NEW'S <no-reply@localhost>"),
    /** Defaults to on in development, off elsewhere. */
    SEED_SAMPLE_CONTENT: z.enum(['true', 'false', '']).optional(),
    TRUST_PROXY: bool(false),
  })
  .transform((env, ctx) => {
    const production = env.NODE_ENV === 'production';
    const pepper = env.HASH_PEPPER || (production ? '' : DEV_PEPPER);
    const seedSampleContent = env.SEED_SAMPLE_CONTENT ? env.SEED_SAMPLE_CONTENT === 'true' : env.NODE_ENV === 'development';
    if (pepper.length < 16) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['HASH_PEPPER'], message: 'Set HASH_PEPPER to a random string of 16+ characters' });
    }
    if (production && seedSampleContent) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SEED_SAMPLE_CONTENT'], message: 'Sample content must not be seeded in production' });
    }
    if (production && !env.SMTP_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_URL'], message: 'Production needs SMTP_URL (sign-in codes must not go to the log)' });
    }
    return {
      env: env.NODE_ENV,
      production,
      host: env.HOST,
      port: env.PORT,
      databaseUrl: env.DATABASE_URL || undefined,
      corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      publicSiteUrl: env.PUBLIC_SITE_URL,
      cookieDomain: env.COOKIE_DOMAIN || undefined,
      hashPepper: pepper,
      mediaBaseUrl: env.MEDIA_BASE_URL.replace(/\/+$/, ''),
      smtpUrl: env.SMTP_URL || undefined,
      mailFrom: env.MAIL_FROM,
      seedSampleContent,
      trustProxy: env.TRUST_PROXY,
    };
  });

export type Config = z.output<typeof Env>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
