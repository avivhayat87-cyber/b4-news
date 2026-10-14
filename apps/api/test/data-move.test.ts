// Moving the live data to the cloud: the embedded database becomes SQL that PostgreSQL
// loads (schema, migrations record and rows), and only the files the server made go
// to the bucket.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, seedReferenceData } from '@b4/db';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/lib/storage';
import { dumpPglite, uploadMediaDir } from '../src/services/data-move';

const tmp = mkdtempSync(path.join(tmpdir(), 'b4-move-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('moving the live data to the cloud', () => {
  it('dumps the embedded database as SQL with its tables, migrations and rows', async () => {
    const dir = path.join(tmp, 'db');
    const handle = createDb(`pglite:${dir}`);
    await handle.migrate();
    await seedReferenceData(handle.db);
    await handle.close();

    const out = path.join(tmp, 'live.sql');
    await dumpPglite(dir, out);
    const sqlText = readFileSync(out, 'utf8');
    expect(sqlText).toMatch(/CREATE TABLE "public"\."articles"/);
    // The embedded pg_dump writes rows as INSERT statements.
    expect(sqlText).toMatch(/INSERT INTO "public"\."categories"/);
    expect(sqlText).toMatch(/"drizzle"\."__drizzle_migrations"/);
    expect(sqlText).not.toMatch(/OWNER TO/);
  }, 60_000);

  it('uploads only the media files the server made', async () => {
    const media = path.join(tmp, 'media');
    const key = '2026/10/0aaecf7b-b787-4f80-92b0-d0d71ee6d21c/hero-6013e7.webp';
    mkdirSync(path.join(media, ...key.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(path.join(media, ...key.split('/')), 'webp');
    writeFileSync(path.join(media, 'notes.txt'), 'not media');
    const storage = new MemoryStorage();
    const result = await uploadMediaDir(storage, media);
    expect(result).toEqual({ uploaded: 1, skipped: ['notes.txt'] });
    expect(storage.files.get(key)?.toString()).toBe('webp');
  });
});
