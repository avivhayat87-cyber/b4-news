import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', ''])
    .default(fallback ? 'true' : 'false')
    .transform((v) => (v === '' ? fallback : v === 'true'));

/** Unset or empty -> undefined, so "FOO=" in .env behaves like a missing variable. */
const optionalBool = z
  .enum(['true', 'false', ''])
  .optional()
  .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined));

const DEV_PEPPER = 'local-development-pepper-not-secret';
const DEV_REVALIDATE_SECRET = 'local-development-revalidate-secret';
const DEFAULT_MEDIA_DIR = fileURLToPath(new URL('../../../.data/media', import.meta.url));

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().optional(),
    // Site (3000), CMS (3001), the app's web build (8081)
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:8081'),
    PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
    /** This API's own public origin (links to media and the development sample sites). */
    PUBLIC_API_URL: z.string().url().optional(),
    COOKIE_DOMAIN: z.string().optional(),
    HASH_PEPPER: z.string().optional(),
    MEDIA_DIR: z.string().default(DEFAULT_MEDIA_DIR),
    MEDIA_BASE_URL: z.string().default(''),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("B4 NEW'S <no-reply@localhost>"),
    /** Defaults to on in development, off elsewhere. */
    SEED_SAMPLE_CONTENT: z.enum(['true', 'false', '']).optional(),
    TRUST_PROXY: bool(false),

    // Background work: "inline" runs the job worker inside this process; "off" leaves it to `npm run worker`.
    WORKER: z.enum(['inline', 'off']).default('inline'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),

    // AI. Without keys, development uses stand-ins so every screen still works.
    AI_PROVIDER: z.enum(['anthropic', 'fake', '']).default(''),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-sonnet-5-5'),
    AI_MODEL_FAST: z.string().default('claude-haiku-5-5'),
    IMAGE_PROVIDER: z.enum(['openai', 'placeholder', '']).default(''),
    OPENAI_API_KEY: z.string().optional(),
    IMAGE_MODEL: z.string().default('gpt-image-2'),
    /** Generate the first 4 article images automatically after the AI rewrite. */
    AUTO_IMAGES: bool(true),

    // Scraping
    SCRAPER_USER_AGENT: z.string().default('B4NewsBot/1.0 (+https://b4news.co.il/bot)'),
    /** Allow fetching private/loopback addresses. Development only (the sample sites live on localhost). */
    SCRAPER_ALLOW_PRIVATE: optionalBool,
    /** Serve sample news sites under /dev/sites for local discovery runs. */
    DEV_FIXTURES: optionalBool,

    // Publishing
    REVALIDATE_SECRET: z.string().optional(),
    SITE_REVALIDATE_URL: z.string().url().optional(),
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  })
  .transform((env, ctx) => {
    const production = env.NODE_ENV === 'production';
    const development = env.NODE_ENV === 'development';
    const pepper = env.HASH_PEPPER || (production ? '' : DEV_PEPPER);
    const seedSampleContent = env.SEED_SAMPLE_CONTENT ? env.SEED_SAMPLE_CONTENT === 'true' : development;
    const publicApiUrl = (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '');
    const textProvider = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'fake');
    const imageProvider = env.IMAGE_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : 'placeholder');
    const devFixtures = env.DEV_FIXTURES ?? development;
    const allowPrivate = env.SCRAPER_ALLOW_PRIVATE ?? development;

    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (pepper.length < 16) issue('HASH_PEPPER', 'Set HASH_PEPPER to a random string of 16+ characters');
    if (production && seedSampleContent) issue('SEED_SAMPLE_CONTENT', 'Sample content must not be seeded in production');
    if (production && !env.SMTP_URL) issue('SMTP_URL', 'Production needs SMTP_URL (sign-in codes must not go to the log)');
    if (textProvider === 'anthropic' && !env.ANTHROPIC_API_KEY) issue('ANTHROPIC_API_KEY', 'AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    if (imageProvider === 'openai' && !env.OPENAI_API_KEY) issue('OPENAI_API_KEY', 'IMAGE_PROVIDER=openai needs OPENAI_API_KEY');
    if (production && textProvider === 'fake') issue('ANTHROPIC_API_KEY', 'Production needs a real AI provider (set ANTHROPIC_API_KEY)');
    if (production && imageProvider === 'placeholder') issue('OPENAI_API_KEY', 'Production needs a real image provider (set OPENAI_API_KEY)');
    if (production && (devFixtures || allowPrivate)) issue('DEV_FIXTURES', 'DEV_FIXTURES and SCRAPER_ALLOW_PRIVATE are for development only');
    if (production && (!env.REVALIDATE_SECRET || env.REVALIDATE_SECRET.length < 16)) {
      issue('REVALIDATE_SECRET', 'Production needs REVALIDATE_SECRET (16+ characters, same value as the site)');
    }

    return {
      env: env.NODE_ENV,
      production,
      host: env.HOST,
      port: env.PORT,
      databaseUrl: env.DATABASE_URL || undefined,
      corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      publicSiteUrl: env.PUBLIC_SITE_URL.replace(/\/+$/, ''),
      publicApiUrl,
      cookieDomain: env.COOKIE_DOMAIN || undefined,
      hashPepper: pepper,
      mediaDir: env.MEDIA_DIR,
      mediaBaseUrl: (env.MEDIA_BASE_URL || `${publicApiUrl}/media`).replace(/\/+$/, ''),
      smtpUrl: env.SMTP_URL || undefined,
      mailFrom: env.MAIL_FROM,
      seedSampleContent,
      trustProxy: env.TRUST_PROXY,
      worker: { mode: env.WORKER, concurrency: env.WORKER_CONCURRENCY },
      ai: {
        text: textProvider as 'anthropic' | 'fake',
        image: imageProvider as 'openai' | 'placeholder',
        anthropicKey: env.ANTHROPIC_API_KEY,
        model: env.AI_MODEL,
        modelFast: env.AI_MODEL_FAST,
        openaiKey: env.OPENAI_API_KEY,
        imageModel: env.IMAGE_MODEL,
        autoImages: env.AUTO_IMAGES,
      },
      scraper: { userAgent: env.SCRAPER_USER_AGENT, allowPrivate },
      devFixtures,
      revalidate: {
        url: env.SITE_REVALIDATE_URL ?? `${env.PUBLIC_SITE_URL.replace(/\/+$/, '')}/api/revalidate`,
        secret: env.REVALIDATE_SECRET || (production ? '' : DEV_REVALIDATE_SECRET),
      },
      metaGraphVersion: env.META_GRAPH_VERSION,
    };
  });

export type Config = z.output<typeof Env> & { socialSecret(ref: string): string | undefined };

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  // Social network tokens live in the environment (or a secrets manager feeding it), never in the database.
  return { ...parsed.data, socialSecret: (ref) => source[`SOCIAL_SECRET_${ref}`] || undefined };
}
