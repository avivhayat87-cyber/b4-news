// Writing a draft's content into the articles table: the tags of an article, and an update
// of an article that is already on the site (same id and address, homepage position kept).
// Used by the publish job and by "שמירה ועדכון באתר"; database only, no HTTP or cache work.
import { docToHtml, docToText, excerptFrom, readingMinutes, sanitizeDoc } from '@b4/shared';
import { type Db, articleDrafts, articles, articleTags, categories, eq, inArray, tags } from '@b4/db';
import { errors } from '../errors';
import type { DraftRow } from './drafts';

/** Rough paragraphs from stored HTML, for articles that were never in the editor. */
function htmlToText(html: string): string {
  return html
    .replace(/<h[23][^>]*>/gi, '\n\n## ')
    .replace(/<li[^>]*>/gi, '\n\n- ')
    .replace(/<\/(p|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A published article's text: from its document, else from its HTML, else its excerpt. */
export function articleBodyText(a: { bodyDoc: unknown; bodyHtml: string; excerpt: string }): string {
  try {
    const text = docToText(sanitizeDoc(a.bodyDoc));
    if (text.trim()) return text;
  } catch {
    // not a document (articles from before the editor)
  }
  return htmlToText(a.bodyHtml) || a.excerpt;
}

function tagSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** An article's tags become exactly these names; tags that don't exist yet are created. */
export async function setArticleTags(db: Db, articleId: number, names: string[]): Promise<void> {
  await db.delete(articleTags).where(eq(articleTags.articleId, articleId));
  for (const name of names) {
    const slug = tagSlug(name);
    if (!slug) continue;
    await db.insert(tags).values({ slug, name: name.trim() }).onConflictDoNothing({ target: tags.slug });
    const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1);
    if (tag) await db.insert(articleTags).values({ articleId, tagId: tag.id }).onConflictDoNothing();
  }
}

/**
 * The draft of a published article goes back into that article. Returns what the site
 * must refresh: the article, and its sections before and after (the section may change).
 */
export async function updateArticleFromDraft(db: Db, draft: DraftRow, editorId: string): Promise<{ id: number; slug: string; categories: string[] }> {
  const id = draft.publishedArticleId;
  const [before] = id ? await db.select({ slug: articles.slug, categoryId: articles.categoryId }).from(articles).where(eq(articles.id, id)).limit(1) : [];
  if (!id || !before) throw errors.notFound('הכתבה');
  const doc = sanitizeDoc(draft.bodyDoc);
  const text = docToText(doc);
  await db
    .update(articles)
    .set({
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim(),
      bodyDoc: doc,
      bodyHtml: docToHtml(doc),
      excerpt: draft.subtitle.trim() || excerptFrom(text),
      categoryId: draft.categoryId!,
      authorId: draft.authorId,
      editorId,
      heroMediaId: draft.heroMediaId,
      readingMinutes: readingMinutes(text),
      disclosure: draft.disclosure.trim() || null,
    })
    .where(eq(articles.id, id));
  await setArticleTags(db, id, draft.tagNames);
  await db
    .update(articleDrafts)
    .set({ status: 'published', textFinalizedAt: draft.textFinalizedAt ?? new Date(), updatedBy: editorId })
    .where(eq(articleDrafts.id, draft.id));
  const sections = await db.select({ slug: categories.slug }).from(categories).where(inArray(categories.id, [before.categoryId, draft.categoryId!]));
  return { id, slug: before.slug, categories: sections.map((c) => c.slug) };
}
