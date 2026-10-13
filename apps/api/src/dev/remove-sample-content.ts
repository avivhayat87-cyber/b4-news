// Development only: removes the sample content from the workshop database, keeping real work.
// Stop the API first (the embedded database has one user at a time), then:
//   npx tsx src/dev/remove-sample-content.ts            what would go
//   npx tsx src/dev/remove-sample-content.ts --apply    remove it
//
// Sample content is: the seeded articles (slug "sample-…") and their fictional writers, and
// everything that came from the local sample news sites (sources under /dev/sites/): their
// discovered items, the drafts written from them, articles published from those drafts, and
// magazines left empty. The sample sources stay, archived, so the dev seed doesn't add them back.
import {
  and,
  articleDrafts,
  articles,
  authors,
  createDb,
  defaultDatabaseUrl,
  eq,
  inArray,
  ilike,
  isNotNull,
  magazines,
  or,
  publishJobs,
  pushNotifications,
  scrapedItems,
  socialPosts,
  sources,
  styleFeedback,
  sql,
} from '@b4/db';

const FICTIONAL_WRITERS = ['consultant-1', 'consultant-2', 'consultant-3', 'ceo-1', 'ceo-2'];

async function main() {
  const apply = process.argv.includes('--apply');
  const handle = createDb(process.env.DATABASE_URL || defaultDatabaseUrl());
  const { db } = handle;
  try {
    const sampleSources = (await db.select({ id: sources.id }).from(sources).where(ilike(sources.baseUrl, '%/dev/sites/%'))).map((r) => r.id);
    const sampleItems = sampleSources.length
      ? (await db.select({ id: scrapedItems.id }).from(scrapedItems).where(inArray(scrapedItems.sourceId, sampleSources))).map((r) => r.id)
      : [];
    const drafts = sampleItems.length
      ? await db
          .select({ id: articleDrafts.id, magazineId: articleDrafts.magazineId, articleId: articleDrafts.publishedArticleId })
          .from(articleDrafts)
          .where(inArray(articleDrafts.scrapedItemId, sampleItems))
      : [];
    const draftIds = drafts.map((d) => d.id);
    const fromSampleSites = drafts.flatMap((d) => (d.articleId ? [d.articleId] : []));
    const sampleArticles = (
      await db
        .select({ id: articles.id })
        .from(articles)
        .where(or(ilike(articles.slug, 'sample-%'), fromSampleSites.length ? inArray(articles.id, fromSampleSites) : undefined))
    ).map((r) => r.id);
    const magazineIds = [...new Set(drafts.flatMap((d) => (d.magazineId ? [d.magazineId] : [])))];

    console.log(
      `Sample content: ${sampleArticles.length} articles, ${draftIds.length} drafts, ${magazineIds.length} magazines (removed if left empty), ${sampleItems.length} discovered items from the sample sites.`,
    );
    if (!apply) return console.log('Nothing removed. Run again with --apply to remove it.');

    await db.transaction(async (tx) => {
      // Rows that point at what goes and don't cascade.
      if (sampleArticles.length) {
        await tx.delete(pushNotifications).where(inArray(pushNotifications.articleId, sampleArticles));
        await tx.update(socialPosts).set({ articleId: null }).where(inArray(socialPosts.articleId, sampleArticles));
        await tx.update(styleFeedback).set({ articleId: null }).where(inArray(styleFeedback.articleId, sampleArticles));
      }
      if (draftIds.length) {
        await tx.delete(styleFeedback).where(inArray(styleFeedback.draftId, draftIds));
        await tx.delete(publishJobs).where(inArray(publishJobs.draftId, draftIds));
      }
      // Articles take their tags, homepage slots, comments and shares with them;
      // drafts their revisions, chat, image batches, social package and jobs.
      if (sampleArticles.length) await tx.delete(articles).where(inArray(articles.id, sampleArticles));
      if (draftIds.length) await tx.delete(articleDrafts).where(inArray(articleDrafts.id, draftIds));
      for (const id of magazineIds) {
        const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(articleDrafts).where(eq(articleDrafts.magazineId, id));
        if (Number(left?.n ?? 0) > 0) continue;
        await tx.delete(publishJobs).where(eq(publishJobs.magazineId, id));
        await tx.delete(magazines).where(eq(magazines.id, id));
      }
      if (sampleItems.length) await tx.delete(scrapedItems).where(inArray(scrapedItems.id, sampleItems));
      // The fictional writers go once nothing points at them.
      for (const slug of FICTIONAL_WRITERS) {
        const [writer] = await tx.select({ id: authors.id }).from(authors).where(eq(authors.slug, slug)).limit(1);
        if (!writer) continue;
        const [usedBy] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(articles)
          .where(and(isNotNull(articles.authorId), eq(articles.authorId, writer.id)));
        const [draftsBy] = await tx.select({ n: sql<number>`count(*)::int` }).from(articleDrafts).where(eq(articleDrafts.authorId, writer.id));
        if (Number(usedBy?.n ?? 0) + Number(draftsBy?.n ?? 0) === 0) await tx.delete(authors).where(eq(authors.id, writer.id));
      }
    });
    const [rest] = await db.select({ n: sql<number>`count(*)::int` }).from(articles);
    console.log(`Removed. Articles left: ${rest?.n ?? 0}.`);
  } finally {
    await handle.close();
  }
}

await main();
