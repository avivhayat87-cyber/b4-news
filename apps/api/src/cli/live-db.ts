// Database chores for the live environment. scripts/live.mjs runs these from the
// release being installed, so the code that migrates is the code that will run.
//
//   tsx src/cli/live-db.ts counts  <database-url>          row counts of the tables that hold real work (JSON)
//   tsx src/cli/live-db.ts migrate <database-url>          applies migrations; fails if any of those counts went down
//   tsx src/cli/live-db.ts init    <database-url> [<dir>]  new database: migrations, reference data and, with <dir>,
//                                                          a first admin whose password goes to <dir>/admin.txt
//   tsx src/cli/live-db.ts import-sources <database-url> <file.json>
//                                                          adds tested news sites (exported from another environment) as active
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SelectorConfig } from '@b4/shared';
import { type Db, createDb, seedReferenceData, sources, sql, users } from '@b4/db';
import { z } from 'zod';
import { hashPassword } from '../lib/password';

const ImportedSource = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().startsWith('https://'),
  method: z.enum(['rss', 'sitemap', 'html']),
  listUrls: z.array(z.string().url().startsWith('https://')).min(1).max(20),
  selectorConfig: SelectorConfig,
  devNotes: z.string().max(2000).nullish(),
});

/** The work that must survive every release. Tables a version doesn't have yet are skipped. */
const KEPT = [
  'articles',
  'comments',
  'readers',
  'users',
  'article_drafts',
  'magazines',
  'media_assets',
  'sources',
  'scraped_items',
  'newsletter_subscribers',
  'consents',
  'social_accounts',
  'secrets',
  'app_settings',
];

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const result = (await db.execute(query)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

export async function countRows(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of KEPT) {
    const [exists] = await rows(db, sql`select to_regclass(${`public.${table}`}) is not null as ok`);
    if (!exists?.ok) continue;
    const [row] = await rows(db, sql.raw(`select count(*)::int as n from "${table}"`));
    out[table] = Number(row?.n ?? 0);
  }
  return out;
}

async function main() {
  const [command, url, dir] = process.argv.slice(2);
  if (!command || !url) throw new Error('usage: live-db.ts counts|migrate|init <database-url> [<dir>]');
  const handle = createDb(url);
  try {
    if (command === 'counts') {
      console.log(JSON.stringify(await countRows(handle.db)));
      return;
    }

    if (command === 'migrate') {
      const before = await countRows(handle.db);
      await handle.migrate();
      await seedReferenceData(handle.db);
      const after = await countRows(handle.db);
      const lost = Object.entries(before).filter(([t, n]) => (after[t] ?? 0) < n);
      console.log(JSON.stringify({ before, after }));
      if (lost.length) {
        console.error(`Data went missing in the migration: ${lost.map(([t, n]) => `${t} ${n} -> ${after[t] ?? 0}`).join(', ')}`);
        process.exitCode = 1;
      }
      return;
    }

    if (command === 'init') {
      await handle.migrate();
      await seedReferenceData(handle.db);
      const [{ n } = { n: 0 }] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(users);
      if (dir && Number(n) === 0) {
        const email = 'admin@b4.local';
        const password = randomBytes(12).toString('base64url');
        await handle.db.insert(users).values({ email, fullName: 'מנהל מערכת', role: 'admin', passwordHash: await hashPassword(password) });
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'admin.txt'), `CMS (live)\nemail: ${email}\npassword: ${password}\n`, { mode: 0o600 });
        console.log(`Created the first admin (${email}); the password is in ${path.join(dir, 'admin.txt')}.`);
      }
      console.log(JSON.stringify(await countRows(handle.db)));
      return;
    }

    if (command === 'import-sources') {
      if (!dir) throw new Error('usage: live-db.ts import-sources <database-url> <file.json>');
      const list = z.array(ImportedSource).parse(JSON.parse(readFileSync(dir, 'utf8')));
      const now = new Date();
      for (const s of list) {
        const added = await handle.db
          .insert(sources)
          .values({ ...s, devNotes: s.devNotes ?? null, status: 'active', approvedAt: now, lastTestPassedAt: now })
          .onConflictDoNothing({ target: sources.baseUrl })
          .returning({ id: sources.id });
        console.log(`${added.length ? 'added  ' : 'exists '} ${s.name} (${s.baseUrl})`);
      }
      return;
    }

    throw new Error(`unknown command "${command}"`);
  } finally {
    await handle.close();
  }
}

await main();
