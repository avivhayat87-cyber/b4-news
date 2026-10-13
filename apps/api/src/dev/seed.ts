// Development only: sources pointing at the sample sites, one source waiting
// for the developer, a sample social account, and a first admin user.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SelectorConfig } from '@b4/shared';
import { type Db, categories, eq, socialAccounts, sources, sql, users } from '@b4/db';
import { hashPassword } from '../lib/password';
import { SAMPLE_SITES } from './sample-sites';

export async function seedDevSources(db: Db, publicApiUrl: string): Promise<void> {
  const base = `${publicApiUrl}/dev/sites`;
  const [world] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, 'global-economy')).limit(1);
  const article: SelectorConfig['article'] = { title: 'h1.headline', intro: '.subtitle', body: '.article-body', image: 'meta[property="og:image"]', remove: ['.related'] };
  const now = new Date();
  const rows = [
    {
      name: SAMPLE_SITES.calc.name,
      baseUrl: `${base}/calc/`,
      listUrls: [`${base}/calc/feed.xml`],
      method: 'rss' as const,
      selectorConfig: { list: { maxItems: 40 }, article, categoryRules: [] },
      defaultCategoryId: null,
    },
    {
      name: SAMPLE_SITES.market.name,
      baseUrl: `${base}/market/`,
      listUrls: [`${base}/market/`],
      method: 'html' as const,
      selectorConfig: { list: { item: '.story-list .story', link: 'a.story-link', maxItems: 40 }, article, categoryRules: [] },
      defaultCategoryId: null,
    },
    {
      name: SAMPLE_SITES.world.name,
      baseUrl: `${base}/world/`,
      listUrls: [`${base}/world/sitemap.xml`],
      method: 'sitemap' as const,
      selectorConfig: { list: { maxItems: 40 }, article, categoryRules: [] },
      defaultCategoryId: world?.id ?? null,
    },
    {
      name: SAMPLE_SITES.global.name,
      baseUrl: `${base}/global/`,
      listUrls: [`${base}/global/feed.xml`],
      method: 'rss' as const,
      selectorConfig: { list: { maxItems: 40 }, article, categoryRules: [] },
      defaultCategoryId: null,
      region: 'international' as const,
      language: 'en',
    },
  ];
  for (const r of rows) {
    await db
      .insert(sources)
      .values({ ...r, status: 'active', approvedAt: now, lastTestPassedAt: now, devNotes: 'אתר לדוגמה לפיתוח מקומי' })
      .onConflictDoNothing({ target: sources.baseUrl });
  }

  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(socialAccounts);
  if (n === 0) {
    await db.insert(socialAccounts).values([
      { platform: 'facebook', displayName: 'B4 NEW\'S בפייסבוק (לדוגמה)', externalId: 'sample-page', secretRef: 'FACEBOOK_PAGE', linkInFirstComment: true },
      { platform: 'instagram', displayName: 'B4 NEW\'S באינסטגרם (לדוגמה)', externalId: 'sample-ig', secretRef: 'INSTAGRAM', linkInFirstComment: true },
      { platform: 'telegram', displayName: 'ערוץ הטלגרם (לדוגמה)', externalId: '@sample_channel', secretRef: 'TELEGRAM_BOT', linkInFirstComment: false },
      { platform: 'whatsapp', displayName: 'ערוץ הוואטסאפ (לדוגמה)', externalId: 'sample-channel', secretRef: 'WHATSAPP', linkInFirstComment: false },
    ]);
  }
}

/** First run only: creates an admin with a random password and writes it to .data/dev-admin.txt. */
export async function ensureDevAdmin(db: Db, dataDir: string): Promise<void> {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  if (n > 0) return;
  const email = 'admin@b4.local';
  const password = randomBytes(9).toString('base64url');
  await db.insert(users).values({ email, fullName: 'מנהל מערכת', role: 'admin', passwordHash: await hashPassword(password) });
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'dev-admin.txt');
  writeFileSync(file, `CMS (development)\nemail: ${email}\npassword: ${password}\n`, { mode: 0o600 });
  console.log(`\nCreated development admin ${email}. Password saved in ${file}\n`);
}
