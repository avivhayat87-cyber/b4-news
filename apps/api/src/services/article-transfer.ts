// Moving published articles from one environment to another (the workshop's real articles to
// the live site), with their main image, section, byline, tags and home-page places. A bundle
// is a folder: articles.json and one image file per article. Importing is safe to repeat: an
// article whose address (slug) already exists is skipped. Drafts, comments and AI history stay
// behind; on the live site "כתבות באתר" > "עריכה" opens a new draft for an imported article.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docToHtml, docToText, sanitizeDoc, textToDoc } from '@b4/shared';
import { type Db, articleTags, articles, asc, authors, categories, eq, homepageSlots, inArray, mediaAssets, sources, tags } from '@b4/db';
import { z } from 'zod';
import { ingestImage } from '../lib/images';
import type { MediaStorage } from '../lib/storage';
import { articleBodyText, setArticleTags } from './article-content';

const MEDIA_KINDS = ['upload', 'scraped_original', 'ai_article', 'ai_social', 'ai_preview'] as const;

const TransferredArticle = z.object({
  slug: z.string().min(1).max(200),
  status: z.enum(['published', 'scheduled', 'unpublished']),
  title: z.string().min(1),
  subtitle: z.string(),
  bodyDoc: z.unknown(),
  bodyHtml: z.string(),
  excerpt: z.string(),
  category: z.string(),
  author: z.object({ slug: z.string(), displayName: z.string(), title: z.string().nullable(), bio: z.string().nullable(), isColumnist: z.boolean() }).nullable(),
  /** The original report's site, matched by its address in the target environment. */
  sourceBaseUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  readingMinutes: z.number().int(),
  commentsEnabled: z.boolean(),
  disclosure: z.string().nullable(),
  publishedAt: z.string(),
  tags: z.array(z.string()),
  homepage: z.array(z.object({ zone: z.enum(['main', 'trending']), position: z.number().int(), pinned: z.boolean() })),
  hero: z
    .object({
      file: z.string().regex(/^hero-\d+\.(webp|jpg|png)$/),
      kind: z.enum(MEDIA_KINDS),
      originalUrl: z.string().nullable(),
      altText: z.string().nullable(),
      credit: z.string().nullable(),
      isAiGenerated: z.boolean(),
      aiPrompt: z.string().nullable(),
      focalX: z.number(),
      focalY: z.number(),
    })
    .nullable(),
});
type TransferredArticle = z.infer<typeof TransferredArticle>;

const LIST = 'articles.json';

/** The body as the whitelisted document; an article that only has HTML is rebuilt from its text. */
function safeDoc(bodyDoc: unknown, bodyHtml: string) {
  try {
    const doc = sanitizeDoc(bodyDoc);
    if (docToText(doc).trim()) return doc;
  } catch {
    // not a document: the text of its HTML instead
  }
  return textToDoc(articleBodyText({ bodyDoc: null, bodyHtml, excerpt: '' }));
}

/** Writes every article of this environment, with its main image, to a bundle folder. */
export async function exportArticles(db: Db, storage: MediaStorage, outDir: string): Promise<number> {
  const rows = await db
    .select({ a: articles, category: categories.slug, author: authors, sourceBaseUrl: sources.baseUrl, hero: mediaAssets })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(authors, eq(articles.authorId, authors.id))
    .leftJoin(sources, eq(articles.sourceId, sources.id))
    .leftJoin(mediaAssets, eq(articles.heroMediaId, mediaAssets.id))
    .orderBy(asc(articles.publishedAt));
  const ids = rows.map((r) => r.a.id);
  const [tagRows, slots] = ids.length
    ? await Promise.all([
        db.select({ articleId: articleTags.articleId, name: tags.name }).from(articleTags).innerJoin(tags, eq(articleTags.tagId, tags.id)).where(inArray(articleTags.articleId, ids)),
        db.select().from(homepageSlots).where(inArray(homepageSlots.articleId, ids)),
      ])
    : [[], []];

  await mkdir(outDir, { recursive: true });
  const list: TransferredArticle[] = [];
  for (const [i, { a, category, author, sourceBaseUrl, hero }] of rows.entries()) {
    let heroOut: TransferredArticle['hero'] = null;
    if (hero) {
      const file = `hero-${i + 1}.${hero.storageKey.split('.').pop()}`;
      await writeFile(path.join(outDir, file), await storage.get(hero.storageKey));
      heroOut = {
        file,
        kind: hero.kind,
        originalUrl: hero.originalUrl,
        altText: hero.altText,
        credit: hero.credit,
        isAiGenerated: hero.isAiGenerated,
        aiPrompt: hero.aiPrompt,
        focalX: hero.focalX,
        focalY: hero.focalY,
      };
    }
    list.push({
      slug: a.slug,
      status: a.status,
      title: a.title,
      subtitle: a.subtitle,
      bodyDoc: a.bodyDoc,
      bodyHtml: a.bodyHtml,
      excerpt: a.excerpt,
      category,
      author: author ? { slug: author.slug, displayName: author.displayName, title: author.title, bio: author.bio, isColumnist: author.isColumnist } : null,
      sourceBaseUrl,
      sourceUrl: a.sourceUrl,
      seoTitle: a.seoTitle,
      seoDescription: a.seoDescription,
      readingMinutes: a.readingMinutes,
      commentsEnabled: a.commentsEnabled,
      disclosure: a.disclosure,
      publishedAt: a.publishedAt.toISOString(),
      tags: tagRows.filter((t) => t.articleId === a.id).map((t) => t.name),
      homepage: slots.filter((s) => s.articleId === a.id).map((s) => ({ zone: s.zone, position: s.position, pinned: s.pinned })),
      hero: heroOut,
    });
  }
  await writeFile(path.join(outDir, LIST), JSON.stringify(list, null, 2));
  return list.length;
}

/** Adds a bundle's articles to this environment. Articles already here (same slug) are left alone. */
export async function importArticles(db: Db, storage: MediaStorage, dir: string): Promise<{ added: string[]; skipped: string[] }> {
  const list = z.array(TransferredArticle).parse(JSON.parse(await readFile(path.join(dir, LIST), 'utf8')));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const a of list) {
    const [exists] = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, a.slug)).limit(1);
    if (exists) {
      skipped.push(a.title);
      continue;
    }
    await db.transaction(async (tx) => {
      const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, a.category)).limit(1);
      if (!category) throw new Error(`unknown section "${a.category}" (article ${a.slug})`);
      let authorId: string | null = null;
      if (a.author) {
        await tx.insert(authors).values(a.author).onConflictDoNothing({ target: authors.slug });
        const [row] = await tx.select({ id: authors.id }).from(authors).where(eq(authors.slug, a.author.slug)).limit(1);
        authorId = row?.id ?? null;
      }
      const [source] = a.sourceBaseUrl ? await tx.select({ id: sources.id }).from(sources).where(eq(sources.baseUrl, a.sourceBaseUrl)).limit(1) : [];
      const hero = a.hero
        ? await ingestImage(tx, storage, await readFile(path.join(dir, a.hero.file)), {
            kind: a.hero.kind,
            originalUrl: a.hero.originalUrl,
            alt: a.hero.altText,
            credit: a.hero.credit,
            isAiGenerated: a.hero.isAiGenerated,
            aiPrompt: a.hero.aiPrompt,
            focalX: a.hero.focalX,
            focalY: a.hero.focalY,
          })
        : null;
      // The site's HTML comes only from the safe renderer, never from the bundle as it is.
      const doc = safeDoc(a.bodyDoc, a.bodyHtml);
      const [article] = await tx
        .insert(articles)
        .values({
          slug: a.slug,
          status: a.status,
          title: a.title,
          subtitle: a.subtitle,
          bodyDoc: doc,
          bodyHtml: docToHtml(doc),
          excerpt: a.excerpt,
          categoryId: category.id,
          authorId,
          heroMediaId: hero?.id ?? null,
          sourceId: source?.id ?? null,
          sourceUrl: a.sourceUrl,
          seoTitle: a.seoTitle,
          seoDescription: a.seoDescription,
          readingMinutes: a.readingMinutes,
          commentsEnabled: a.commentsEnabled,
          disclosure: a.disclosure,
          publishedAt: new Date(a.publishedAt),
        })
        .returning({ id: articles.id });
      await setArticleTags(tx, article!.id, a.tags);
      // A place already taken on the target's home page stays with its article.
      for (const slot of a.homepage) await tx.insert(homepageSlots).values({ ...slot, articleId: article!.id }).onConflictDoNothing();
    });
    added.push(a.title);
  }
  return { added, skipped };
}
