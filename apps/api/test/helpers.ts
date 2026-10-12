import { createDb, seedReferenceData, seedSampleContent, users } from '@b4/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedDevSources } from '../src/dev/seed';
import { JobRunner } from '../src/lib/jobs';
import { MemoryMailer } from '../src/lib/mailer';
import { hashPassword } from '../src/lib/password';
import { MemoryStorage } from '../src/lib/storage';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import { handlers } from '../src/services/handlers';
import type { Fetcher } from '../src/services/scraper/collect';

export const ORIGIN = 'http://site.test';
export const API = 'http://api.test';

export async function setup(opts: { fetch?: Fetcher } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    CORS_ORIGINS: ORIGIN,
    PUBLIC_SITE_URL: ORIGIN,
    PUBLIC_API_URL: API,
    DEV_FIXTURES: 'true',
    AUTO_IMAGES: 'true',
    SITE_REVALIDATE_URL: 'http://127.0.0.1:9/api/revalidate',
  } as NodeJS.ProcessEnv);
  const handle = createDb('memory:');
  await handle.migrate();
  await seedReferenceData(handle.db);
  await seedSampleContent(handle.db);
  const mailer = new MemoryMailer();
  const storage = new MemoryStorage();

  // Requests to the sample sites are answered in-process, so tests never touch the network.
  let inject: ((url: string) => Promise<{ statusCode: number; headers: Record<string, unknown>; rawPayload: Buffer }>) | null = null;
  const fixtureFetch: Fetcher = async (url) => {
    const u = new URL(url);
    if (u.origin !== API || !inject) throw new Error(`unexpected fetch in test: ${url}`);
    const res = await inject(u.pathname + u.search);
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
    return { url, status: 200, contentType: String(res.headers['content-type'] ?? ''), body: res.rawPayload };
  };

  const app = await buildApp({ config, db: handle.db, mailer, logger: false, storage, ai: fixedAi(new FakeText(), new PlaceholderImages()), fetch: opts.fetch ?? fixtureFetch });
  inject = (path) => app.inject({ method: 'GET', url: path });
  const runner = new JobRunner(handle.db, handlers, app.services, { concurrency: 1 });
  return {
    app,
    db: handle.db,
    mailer,
    storage,
    config,
    /** Runs every queued background job (AI, discovery, publishing) to completion. */
    drain: () => runner.drain(),
    seedSources: () => seedDevSources(handle.db, API),
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function codeFrom(ctx: Ctx, email: string): string {
  const mail = ctx.mailer.lastTo(email);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code mailed to ${email}`);
  return code;
}

/** A distinct client address per test reader, so per-IP rate limits don't interfere. */
function addressFor(email: string): string {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `10.${(h >> 16) & 255}.${(h >> 8) & 255}.${h & 255}`;
}

/** Full sign-in through the API; returns the session cookie header value. */
export async function signInReader(ctx: Ctx, email: string, displayName: string): Promise<string> {
  const remoteAddress = addressFor(email);
  const requested = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/request-code', payload: { email }, remoteAddress });
  if (requested.statusCode !== 204) throw new Error(`request-code ${requested.statusCode}: ${requested.body}`);
  const verified = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/reader/verify',
    payload: { email, code: codeFrom(ctx, email), displayName },
    remoteAddress,
  });
  if (verified.statusCode !== 200) throw new Error(`verify ${verified.statusCode}: ${verified.body}`);
  const cookie = verified.cookies.find((c) => c.name === 'b4_rs');
  if (!cookie) throw new Error('no session cookie');
  return `b4_rs=${cookie.value}`;
}

export async function signInStaff(ctx: Ctx, role: 'admin' | 'editor' | 'developer' | 'viewer' = 'editor'): Promise<string> {
  const email = `${role}@newsroom.test`;
  await ctx.db
    .insert(users)
    .values({ email, fullName: `Test ${role}`, role, passwordHash: await hashPassword('correct horse battery') })
    .onConflictDoNothing();
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/staff/login',
    payload: { email, password: 'correct horse battery' },
    remoteAddress: addressFor(email),
  });
  if (res.statusCode !== 200) throw new Error(`staff login ${res.statusCode}: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'b4_ss');
  if (!cookie) throw new Error('no staff cookie');
  return `b4_ss=${cookie.value}`;
}

/** A staff member's client: cookie + allowed Origin on every request. */
export function staffClient(ctx: Ctx, cookie: string) {
  const headers = { cookie, origin: ORIGIN };
  const call = async <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await ctx.app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : null) as T };
  };
  return {
    get: <T = any>(url: string) => call<T>('GET', url),
    post: <T = any>(url: string, payload: unknown = {}) => call<T>('POST', url, payload),
    put: <T = any>(url: string, payload: unknown) => call<T>('PUT', url, payload),
    patch: <T = any>(url: string, payload: unknown) => call<T>('PATCH', url, payload),
  };
}

export { codeFrom };
