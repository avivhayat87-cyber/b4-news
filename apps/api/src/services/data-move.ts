// Moving the live data from the computer to the cloud, once: the embedded database
// (PGlite) as a plain SQL dump that PostgreSQL loads, and the media folder into the
// bucket. Nothing is changed where the data comes from.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import { type MediaStorage, isMediaKey } from '../lib/storage';

/** A plain SQL dump of an embedded database folder, ready for `psql` on PostgreSQL 17. */
export async function dumpPglite(dataDir: string, outFile: string): Promise<number> {
  const pg = new PGlite(dataDir);
  try {
    // No owners or privileges: the cloud database has its own role.
    const file = await pgDump({ pg, args: ['--no-owner', '--no-privileges', '--quote-all-identifiers'] });
    const sqlText = await file.text();
    writeFileSync(outFile, sqlText);
    return sqlText.length;
  } finally {
    await pg.close();
  }
}

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' };

/** Every media file the server made, from a local folder into the storage (a file already there is written again). */
export async function uploadMediaDir(storage: MediaStorage, dir: string, onFile?: (key: string) => void): Promise<{ uploaded: number; skipped: string[] }> {
  const skipped: string[] = [];
  let uploaded = 0;
  const walk = async (rel: string): Promise<void> => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(key);
      else if (isMediaKey(key)) {
        await storage.put(key, readFileSync(path.join(dir, ...key.split('/'))), TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? 'application/octet-stream');
        uploaded++;
        onFile?.(key);
      } else skipped.push(key);
    }
  };
  await walk('');
  return { uploaded, skipped };
}
