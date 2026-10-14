// Moving the articles from one environment to another (the workshop's real articles to the live
// site): text, section, main image (its renditions cut again), tags and home-page places, once.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { articles, categories, createDb, desc, eq, homepageSlots, mediaAssets, seedReferenceData } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestImage } from '../src/lib/images';
import { MemoryStorage } from '../src/lib/storage';
import { setArticleTags } from '../src/services/article-content';
import { exportArticles, importArticles } from '../src/services/article-transfer';
import { setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let dir: string;

beforeAll(async () => {
  ctx = await setup();
  dir = await mkdtemp(path.join(tmpdir(), 'b4-transfer-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await ctx.close();
});

describe('moving articles between environments', () => {
  it('moves every article with its main image, section, tags and home-page place, and only once', async () => {
    const [first] = await ctx.db.select().from(articles).orderBy(desc(articles.publishedAt)).limit(1);
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3366aa' } }).png().toBuffer();
    const hero = await ingestImage(ctx.db, ctx.storage, png, { kind: 'upload', alt: 'בניין בנק ישראל', credit: 'צילום: המערכת', focalY: 0.3 });
    await ctx.db.update(articles).set({ heroMediaId: hero.id }).where(eq(articles.id, first!.id));
    await setArticleTags(ctx.db, first!.id, ['ריבית', 'בנק ישראל']);
    const total = (await ctx.db.select({ id: articles.id }).from(articles)).length;
    const slots = (await ctx.db.select().from(homepageSlots)).length;

    expect(await exportArticles(ctx.db, ctx.storage, dir)).toBe(total);

    // A new, empty environment (like the live site before its first article).
    const target = createDb('memory:');
    await target.migrate();
    await seedReferenceData(target.db);
    const storage = new MemoryStorage();
    try {
      const imported = await importArticles(target.db, storage, dir);
      expect(imported.added).toHaveLength(total);

      const [moved] = await target.db
        .select({ a: articles, category: categories.slug })
        .from(articles)
        .innerJoin(categories, eq(articles.categoryId, categories.id))
        .where(eq(articles.slug, first!.slug));
      expect(moved!.a).toMatchObject({ title: first!.title, bodyHtml: first!.bodyHtml, status: first!.status, publishedAt: first!.publishedAt });
      expect(moved!.a.id).toBeGreaterThan(0);
      const [image] = await target.db.select().from(mediaAssets).where(eq(mediaAssets.id, moved!.a.heroMediaId!));
      expect(image).toMatchObject({ altText: 'בניין בנק ישראל', credit: 'צילום: המערכת', focalY: 0.3, width: 1200, height: 800 });
      expect(Object.keys(image!.variants)).toEqual(expect.arrayContaining(['hero', 'card', 'thumb']));
      expect(storage.files.has(image!.storageKey)).toBe(true);
      expect((await target.db.select().from(homepageSlots)).length).toBe(slots);

      // Running it again adds nothing.
      const again = await importArticles(target.db, storage, dir);
      expect(again).toMatchObject({ added: [], skipped: expect.arrayContaining([first!.title]) });
      expect((await target.db.select({ id: articles.id }).from(articles)).length).toBe(total);
    } finally {
      await target.close();
    }
  });
});
