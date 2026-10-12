// Guards the live data (articles, comments, readers) against a database change that
// would lose or break it. Runs in `npm run check` and in every release.
//
//   tsx src/scripts/check-migrations.ts [--against <drizzle folder of the version now live>]
//
// Fails when:
//   - a migration drops or empties data (DROP TABLE/COLUMN/TYPE, TRUNCATE, DELETE, RENAME,
//     changing a column's type, SET NOT NULL) without a "-- data-safe: <reason>" line right
//     above the statement. Add the new column, backfill, switch the code over, and only
//     remove the old one in a later release, once nothing reads it.
//   - the migration files and the journal disagree;
//   - (with --against) a migration the live database already ran was edited or removed:
//     it would never run again, so the live schema would silently differ from the code's.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const RISKY: { pattern: RegExp; why: string }[] = [
  { pattern: /\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA|VIEW|MATERIALIZED\s+VIEW)\b/i, why: 'removes data or structure the running version uses' },
  { pattern: /\bTRUNCATE\b/i, why: 'empties a table' },
  { pattern: /\bDELETE\s+FROM\b/i, why: 'deletes rows' },
  { pattern: /\bRENAME\b/i, why: 'renames what the running version reads by name' },
  { pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, why: 'changes a column type (can fail or truncate existing values)' },
  { pattern: /\bSET\s+NOT\s+NULL\b/i, why: 'fails on existing empty values unless they are filled first' },
];

type Journal = { entries: { idx: number; tag: string; when: number }[] };

function readJournal(dir: string): Journal {
  return JSON.parse(readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as Journal;
}

export function checkMigrations(dir: string, againstDir?: string): string[] {
  const problems: string[] = [];
  const journal = readJournal(dir);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const tags = journal.entries.map((e) => e.tag);

  for (const tag of tags) if (!files.includes(`${tag}.sql`)) problems.push(`${tag}: listed in the journal, but ${tag}.sql is missing`);
  for (const f of files) if (!tags.includes(f.replace(/\.sql$/, ''))) problems.push(`${f}: not in meta/_journal.json (generate migrations with "npm run db:generate")`);
  journal.entries.forEach((e, i) => {
    if (e.idx !== i) problems.push(`${e.tag}: journal index ${e.idx}, expected ${i}`);
    if (i > 0 && e.when <= journal.entries[i - 1]!.when) problems.push(`${e.tag}: dated before the migration it follows, so it would never run on a database that already has that one`);
  });

  // What the live database already ran must stay exactly as it was.
  const applied = new Set<string>();
  if (againstDir && existsSync(path.join(againstDir, 'meta', '_journal.json'))) {
    const live = readJournal(againstDir);
    live.entries.forEach((e, i) => {
      applied.add(e.tag);
      if (tags[i] !== e.tag) problems.push(`${e.tag}: already ran on the live database but is ${tags.includes(e.tag) ? 'out of order' : 'gone'} in this version`);
      const before = path.join(againstDir, `${e.tag}.sql`);
      const now = path.join(dir, `${e.tag}.sql`);
      if (existsSync(before) && existsSync(now) && readFileSync(before, 'utf8') !== readFileSync(now, 'utf8')) {
        problems.push(`${e.tag}.sql: edited after it ran on the live database; put the change in a new migration instead`);
      }
    });
  }

  // New migrations only: statements that could lose data need a stated reason.
  for (const tag of tags.filter((t) => !applied.has(t))) {
    const lines = readFileSync(path.join(dir, `${tag}.sql`), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { pattern, why } of RISKY) {
        if (!pattern.test(line)) continue;
        if (/^\s*--\s*data-safe:\s*\S/.test(lines[i - 1] ?? '')) continue;
        problems.push(`${tag}.sql:${i + 1}: ${line.trim().slice(0, 120)}\n      ${why}. If it is intended, add "-- data-safe: <why no live data is lost>" on the line above.`);
      }
    });
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({ options: { against: { type: 'string' }, dir: { type: 'string' } } });
  const dir = values.dir ?? fileURLToPath(new URL('../../drizzle', import.meta.url));
  const problems = checkMigrations(dir, values.against);
  if (problems.length) {
    console.error(`Migration check failed (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Migrations OK (${readJournal(dir).entries.length}${values.against ? `, checked against ${values.against}` : ''}).`);
}
