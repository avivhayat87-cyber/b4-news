import { createHash } from 'node:crypto';
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
    /** 32 bytes (base64 or hex) that encrypt the API keys and tokens entered in the CMS. Required in production. */
    SECRETS_KEY: z.string().optional(),
    /** "local": files under MEDIA_DIR, served by this API at /media. "r2": a Cloudflare R2 bucket (the cloud). */
    MEDIA_STORAGE: z.enum(['local', 'r2']).default('local'),
    MEDIA_DIR: z.string().default(DEFAULT_MEDIA_DIR),
    /** The public address of the media files; required with r2 (the bucket's custom domain, e.g. https://media.b4news.co.il). */
    MEDIA_BASE_URL: z.string().default(''),
    R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, 'the 32-character Cloudflare account id').optional(),
    R2_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    /** A second, private bucket (same account and keys) that keeps the nightly database backups outside the server. */
    R2_BACKUP_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).optional(),
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
    IMAGE_PROVIDER: z.enum(['gemini', 'placeholder', '']).default(''),
    GEMINI_API_KEY: z.string().optional(),
    /** The quick, low-resolution drafts the editor chooses from. */
    IMAGE_PREVIEW_MODEL: z.string().default('gemini-3.1-flash-lite-image'),
    /** The chosen draft, redrawn at full quality, and the story images. */
    IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
    IMAGE_SIZE: z.enum(['1K', '2K', '4K']).default('2K'),
    /** Draw the first article image drafts automatically after the AI rewrite. */
    AUTO_IMAGES: bool(true),
    /**
     * The Google Cloud project for images and reels through Vertex AI (on the cloud server):
     * billed to that account and authorized by the server's own identity, no key. Empty = the
     * Gemini API key from the CMS. The visual agent stays on that key either way.
     */
    VERTEX_PROJECT: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'a Google Cloud project id').optional(),
    VERTEX_LOCATION: z.string().default('global'),
    /** Veo isn't served from "global". */
    VERTEX_VIDEO_LOCATION: z.string().default('us-central1'),

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
    // "auto": a key entered in the CMS or set here; without one, development uses stand-ins and production refuses.
    const textMode = (env.AI_PROVIDER || 'auto') as 'anthropic' | 'fake' | 'auto';
    const imageMode = (env.IMAGE_PROVIDER || 'auto') as 'gemini' | 'placeholder' | 'auto';
    const secretsKey = decodeKey(env.SECRETS_KEY) ?? (production ? null : createHash('sha256').update(`b4-secrets|${pepper}`).digest());
    const devFixtures = env.DEV_FIXTURES ?? development;
    const allowPrivate = env.SCRAPER_ALLOW_PRIVATE ?? development;

    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (pepper.length < 16) issue('HASH_PEPPER', 'Set HASH_PEPPER to a random string of 16+ characters');
    if (production && seedSampleContent) issue('SEED_SAMPLE_CONTENT', 'Sample content must not be seeded in production');
    if (env.SECRETS_KEY && !decodeKey(env.SECRETS_KEY)) issue('SECRETS_KEY', 'SECRETS_KEY must be 32 bytes, base64 or hex (e.g. `openssl rand -base64 32`)');
    if (production && !secretsKey) issue('SECRETS_KEY', 'Production needs SECRETS_KEY (32 random bytes, base64)');
    if (textMode === 'anthropic' && !env.ANTHROPIC_API_KEY) issue('ANTHROPIC_API_KEY', 'AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    if (imageMode === 'gemini' && !env.GEMINI_API_KEY) issue('GEMINI_API_KEY', 'IMAGE_PROVIDER=gemini needs GEMINI_API_KEY');
    if (production && (textMode === 'fake' || imageMode === 'placeholder')) issue('AI_PROVIDER', 'The AI stand-ins are for development only');
    if (production && (devFixtures || allowPrivate)) issue('DEV_FIXTURES', 'DEV_FIXTURES and SCRAPER_ALLOW_PRIVATE are for development only');
    if (production && (!env.REVALIDATE_SECRET || env.REVALIDATE_SECRET.length < 16)) {
      issue('REVALIDATE_SECRET', 'Production needs REVALIDATE_SECRET (16+ characters, same value as the site)');
    }
    if (env.MEDIA_STORAGE === 'r2') {
      for (const name of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) if (!env[name]) issue(name, `MEDIA_STORAGE=r2 needs ${name}`);
      if (!/^https:\/\//.test(env.MEDIA_BASE_URL)) issue('MEDIA_BASE_URL', 'MEDIA_STORAGE=r2 needs MEDIA_BASE_URL: the bucket\'s public https address');
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
      /** The media bucket (MEDIA_STORAGE=r2); null = files on local disk. */
      mediaBucket:
        env.MEDIA_STORAGE === 'r2'
          ? { endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: env.R2_BUCKET!, accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! }
          : null,
      /** Where the live database backups go off the server; null = they stay on the server only. */
      backupBucket:
        env.R2_BACKUP_BUCKET && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
          ? { endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: env.R2_BACKUP_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
          : null,
      smtpUrl: env.SMTP_URL || undefined,
      mailFrom: env.MAIL_FROM,
      seedSampleContent,
      trustProxy: env.TRUST_PROXY,
      worker: { mode: env.WORKER, concurrency: env.WORKER_CONCURRENCY },
      secretsKey: secretsKey as Buffer,
      ai: {
        text: textMode,
        image: imageMode,
        /** Development without keys: simulated writing and placeholder images. */
        allowStandIns: !production,
        anthropicKey: env.ANTHROPIC_API_KEY,
        model: env.AI_MODEL,
        modelFast: env.AI_MODEL_FAST,
        geminiKey: env.GEMINI_API_KEY,
        imagePreviewModel: env.IMAGE_PREVIEW_MODEL,
        imageModel: env.IMAGE_MODEL,
        imageSize: env.IMAGE_SIZE,
        autoImages: env.AUTO_IMAGES,
        /** Images and reels through Vertex AI; null = the Gemini API key. */
        vertex: env.VERTEX_PROJECT ? { project: env.VERTEX_PROJECT, location: env.VERTEX_LOCATION, videoLocation: env.VERTEX_VIDEO_LOCATION } : null,
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

function decodeKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

export type Config = z.output<typeof Env> & { socialSecret(ref: string): string | undefined };

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // "NAME=" in a .env file means "not set", so defaults apply.
  const parsed = Env.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  // Social tokens can also come from the environment (a secrets manager); a token entered in the CMS wins.
  return { ...parsed.data, socialSecret: (ref) => source[`SOCIAL_SECRET_${ref}`] || undefined };
}
