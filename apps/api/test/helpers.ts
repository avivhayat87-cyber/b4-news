import { createDb, seedReferenceData, seedSampleContent, users } from '@b4/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MemoryMailer } from '../src/lib/mailer';
import { hashPassword } from '../src/lib/password';

export const ORIGIN = 'http://site.test';

export async function setup() {
  const config = loadConfig({ NODE_ENV: 'test', CORS_ORIGINS: ORIGIN, PUBLIC_SITE_URL: ORIGIN } as NodeJS.ProcessEnv);
  const handle = createDb('memory:');
  await handle.migrate();
  await seedReferenceData(handle.db);
  await seedSampleContent(handle.db);
  const mailer = new MemoryMailer();
  const app = await buildApp({ config, db: handle.db, mailer, logger: false });
  return {
    app,
    db: handle.db,
    mailer,
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

export async function signInStaff(ctx: Ctx, role: 'admin' | 'editor' | 'viewer' = 'editor'): Promise<string> {
  const email = `${role}@newsroom.test`;
  await ctx.db
    .insert(users)
    .values({ email, fullName: `Test ${role}`, role, passwordHash: await hashPassword('correct horse battery') })
    .onConflictDoNothing();
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/staff/login',
    payload: { email, password: 'correct horse battery' },
  });
  if (res.statusCode !== 200) throw new Error(`staff login ${res.statusCode}: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'b4_ss');
  if (!cookie) throw new Error('no staff cookie');
  return `b4_ss=${cookie.value}`;
}

export { codeFrom };
