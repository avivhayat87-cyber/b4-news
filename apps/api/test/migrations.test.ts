// The release check that keeps database changes from losing live data.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkMigrations } from '../../../packages/db/src/scripts/check-migrations';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'b4-migrations-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'meta'));
  const tags = Object.keys(files);
  writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag, when: 1000 + idx })) }));
  for (const [tag, body] of Object.entries(files)) writeFileSync(path.join(dir, `${tag}.sql`), body);
  return dir;
}

describe('migration check', () => {
  it('accepts additive changes and loosening a constraint', () => {
    const dir = folder({
      '0000_init': 'CREATE TABLE "articles" ("id" serial PRIMARY KEY);',
      '0001_more': 'ALTER TABLE "articles" ADD COLUMN "subtitle" text;\nALTER TABLE "articles" ALTER COLUMN "subtitle" DROP NOT NULL;\nALTER TABLE "a" DROP CONSTRAINT "a_fk";',
    });
    expect(checkMigrations(dir)).toEqual([]);
  });

  it('stops changes that would lose live data, unless the reason is written down', () => {
    const risky = folder({ '0000_init': 'CREATE TABLE "comments" ("id" serial);', '0001_drop': 'ALTER TABLE "comments" DROP COLUMN "body";\nDELETE FROM "comments";' });
    const problems = checkMigrations(risky);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('0001_drop.sql:1');

    const explained = folder({ '0000_init': 'CREATE TABLE "t" ("id" serial);', '0001_drop': '-- data-safe: the column was empty since 0.4\nALTER TABLE "t" DROP COLUMN "old";' });
    expect(checkMigrations(explained)).toEqual([]);
  });

  it('refuses editing a migration the live database already ran', () => {
    const live = folder({ '0000_init': 'CREATE TABLE "t" ("id" serial);' });
    const next = folder({ '0000_init': 'CREATE TABLE "t" ("id" serial, "x" text);', '0001_more': 'ALTER TABLE "t" ADD COLUMN "y" text;' });
    expect(checkMigrations(next, live).join('\n')).toContain('0000_init.sql: edited after it ran on the live database');
    // Its old statements are not re-checked, only the new migration.
    const fine = folder({ '0000_init': 'CREATE TABLE "t" ("id" serial);', '0001_more': 'ALTER TABLE "t" ADD COLUMN "y" text;' });
    expect(checkMigrations(fine, live)).toEqual([]);
  });
});
