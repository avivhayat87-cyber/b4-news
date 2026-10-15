// Published articles in the CMS ("כתבות באתר"): the list; changing an article that is on the
// site (through its draft, then updated in place); removing it from the site and putting it
// back; and, for admins, deleting a removed article for good.
import { type ArticleListQuery, type PublishedArticleList, TICKER_SIZE, docToText, sanitizeDoc, textToDoc } from '@b4/shared';
import {
  and,
  articleDrafts,
  articles,
  articleTags,
  authors,
  categories,
  comments,
  desc,
  draftRevisions,
  eq,
  homepageSlots,
  ilike,
  inArray,
  mediaAssets,
  pushNotifications,
  socialPosts,
  sql,
  styleFeedback,
  tags,
} from '@b4/db';
import type { z } from 'zod';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import { decodeCursor, encodeCursor, olderThan } from '../lib/cards';
import { variantUrl } from '../lib/images';
import { articleBodyText, updateArticleFromDraft } from './article-content';
import type { Services } from './context';
import { draftErrors, loadDraft } from './drafts';
import { problemsOf, revalidateSite } from './publish';

type Staff = { id: string; fullName: string };

const PAGE_SIZE = 30;
const ON_SITE = ['published', 'scheduled'] as const;

/** What the site refreshes when an article changes: the home page, search, the article and its sections. */
function siteTags(a: { id: number; slug: string; categories: string[] }): string[] {
  return ['home', 'search', `article:${a.id}`, `article-slug:${a.slug}`, ...a.categories.map((c) => `category:${c}`)];
}

async function refreshSite(s: Services, tagList: string[]) {
  await revalidateSite(s, tagList).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'site revalidate failed'));
}

async function articleOf(s: Services, id: number) {
  const [row] = await s.db
    .select({ id: articles.id, slug: articles.slug, status: articles.status, category: categories.slug })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .where(eq(articles.id, id))
    .limit(1);
  if (!row) throw errors.notFound('הכתבה');
  return row;
}

export async function listArticles(s: Services, query: z.infer<typeof ArticleListQuery>): Promise<PublishedArticleList> {
  const q = query.q?.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = await s.db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      status: articles.status,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
      draftId: articles.draftId,
      category: categories.slug,
      author: authors.displayName,
      media: mediaAssets,
      draftStatus: articleDrafts.status,
      commentCount: sql<number>`(select count(*)::int from ${comments} where ${comments.articleId} = ${articles.id} and ${comments.status} = 'visible')`,
      zone: sql<'main' | 'trending' | null>`(select ${homepageSlots.zone} from ${homepageSlots} where ${homepageSlots.articleId} = ${articles.id} limit 1)`,
      // On the ticker: marked, and among the newest marked the site shows.
      onTicker: sql<boolean>`${articles.id} in (select t.id from ${articles} t where t.ticker_at is not null and t.status = 'published' order by t.ticker_at desc limit ${TICKER_SIZE})`,
    })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(authors, eq(articles.authorId, authors.id))
    .leftJoin(mediaAssets, eq(articles.heroMediaId, mediaAssets.id))
    .leftJoin(articleDrafts, eq(articles.draftId, articleDrafts.id))
    .where(
      and(
        query.status === 'unpublished' ? eq(articles.status, 'unpublished') : inArray(articles.status, [...ON_SITE]),
        q ? ilike(articles.title, `%${q}%`) : undefined,
        query.category ? eq(categories.slug, query.category) : undefined,
        olderThan(decodeCursor(query.cursor)),
      ),
    )
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(PAGE_SIZE + 1);

  const items = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    category: r.category,
    publishedAt: r.publishedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    thumbUrl: r.media ? variantUrl(s.storage, r.media, 'thumb') : null,
    author: r.author,
    commentCount: Number(r.commentCount ?? 0),
    onHomepage: r.zone,
    onTicker: Boolean(r.onTicker),
    draftId: r.draftId,
    editing: Boolean(r.draftStatus && r.draftStatus !== 'published'),
  }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null };
}

/** An article on the breaking-news ticker (now, at its head) or off it, from "כתבות באתר". */
export async function setArticleTicker(s: Services, staff: Staff, articleId: number, on: boolean): Promise<void> {
  const a = await articleOf(s, articleId);
  await s.db.update(articles).set({ tickerAt: on ? new Date() : null }).where(eq(articles.id, articleId));
  await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(articleId), action: on ? 'ticker_on' : 'ticker_off' });
  if (a.status === 'published') await refreshSite(s, ['home']);
}

/**
 * Opens an article on the site in the editor. Its draft is reopened; an article that was
 * never in the editor gets a draft made from it. The site doesn't change until the update.
 */
export async function openForEditing(s: Services, staff: Staff, articleId: number): Promise<{ draftId: string }> {
  const [a] = await s.db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!a) throw errors.notFound('הכתבה');
  if (a.draftId) {
    const draft = await loadDraft(s.db, a.draftId);
    if (draft.status === 'published') await s.db.update(articleDrafts).set({ status: 'editing', updatedBy: staff.id }).where(eq(articleDrafts.id, draft.id));
    await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(a.id), action: 'open_for_editing' });
    return { draftId: draft.id };
  }

  let doc;
  try {
    doc = sanitizeDoc(a.bodyDoc);
  } catch {
    doc = textToDoc(articleBodyText(a));
  }
  const bodyText = docToText(doc);
  const tagNames = (await s.db.select({ name: tags.name }).from(articleTags).innerJoin(tags, eq(articleTags.tagId, tags.id)).where(eq(articleTags.articleId, a.id))).map((t) => t.name);
  const draftId = await s.db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(articleDrafts)
      .values({
        origin: 'manual_write',
        status: 'editing',
        title: a.title,
        subtitle: a.subtitle,
        bodyDoc: doc,
        bodyText,
        categoryId: a.categoryId,
        authorId: a.authorId,
        heroMediaId: a.heroMediaId,
        tagNames,
        disclosure: a.disclosure ?? '',
        publishedArticleId: a.id,
        createdBy: staff.id,
        updatedBy: staff.id,
      })
      .returning({ id: articleDrafts.id });
    await tx.insert(draftRevisions).values({ draftId: draft!.id, version: 1, source: 'human_checkpoint', title: a.title, subtitle: a.subtitle, bodyDoc: doc, bodyText, createdBy: staff.id });
    await tx.update(articles).set({ draftId: draft!.id }).where(eq(articles.id, a.id));
    return draft!.id;
  });
  await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(a.id), action: 'open_for_editing' });
  return { draftId };
}

/** "שמירה ועדכון באתר": the edited draft replaces the article on the site, at the same address. */
export async function updateSiteFromDraft(s: Services, staff: Staff, draftId: string): Promise<{ slug: string }> {
  const draft = await loadDraft(s.db, draftId);
  if (!draft.publishedArticleId) throw new AppError(409, 'not_published', 'הכתבה הזאת עוד לא פורסמה. מפרסמים אותה מהתצוגה המקדימה.');
  if (draft.status === 'queued_ai' || draft.status === 'ai_processing') throw draftErrors.aiBusy();
  if (draft.status === 'skipped') throw new AppError(409, 'skipped', 'הכתבה סומנה "לא לפרסם".');
  const [hero] = draft.heroMediaId ? await s.db.select({ kind: mediaAssets.kind }).from(mediaAssets).where(eq(mediaAssets.id, draft.heroMediaId)).limit(1) : [];
  const problems = problemsOf({ ...draft, status: 'text_final' }, new Map(), new Set(hero?.kind === 'ai_preview' && draft.heroMediaId ? [draft.heroMediaId] : []));
  if (problems.length) throw new AppError(422, 'not_ready', `אי אפשר לעדכן עדיין: ${problems.join(', ')}`);

  const updated = await s.db.transaction((tx) => updateArticleFromDraft(tx, draft, staff.id));
  await refreshSite(s, siteTags(updated));
  await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(updated.id), action: 'update' });
  return { slug: updated.slug };
}

/** Off the site at once (and off the home page); the article and its comments are kept. */
export async function unpublishArticle(s: Services, staff: Staff, id: number): Promise<void> {
  const a = await articleOf(s, id);
  if (a.status === 'unpublished') return;
  await s.db.transaction(async (tx) => {
    await tx.update(articles).set({ status: 'unpublished' }).where(eq(articles.id, id));
    await tx.delete(homepageSlots).where(eq(homepageSlots.articleId, id));
  });
  await refreshSite(s, siteTags({ id, slug: a.slug, categories: [a.category] }));
  await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(id), action: 'unpublish' });
}

/** Back on the site at its address and date (the home page position is not restored). */
export async function republishArticle(s: Services, staff: Staff, id: number): Promise<void> {
  const a = await articleOf(s, id);
  if (a.status !== 'unpublished') return;
  await s.db.update(articles).set({ status: 'published' }).where(eq(articles.id, id));
  await refreshSite(s, siteTags({ id, slug: a.slug, categories: [a.category] }));
  await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(id), action: 'republish' });
}

/** For good, with its comments. Only an article already removed from the site; its draft stays, marked as not for publishing. */
export async function deleteArticle(s: Services, staff: Staff, id: number): Promise<void> {
  const a = await articleOf(s, id);
  if (a.status !== 'unpublished') throw new AppError(409, 'still_published', 'קודם מסירים את הכתבה מהאתר, ורק אז אפשר למחוק אותה לצמיתות.');
  await s.db.transaction(async (tx) => {
    // Records that point at the article and outlive it lose the pointer.
    await tx.update(socialPosts).set({ articleId: null }).where(eq(socialPosts.articleId, id));
    await tx.update(styleFeedback).set({ articleId: null }).where(eq(styleFeedback.articleId, id));
    await tx.update(pushNotifications).set({ articleId: null }).where(eq(pushNotifications.articleId, id));
    await tx
      .update(articleDrafts)
      .set({ publishedArticleId: null, status: 'skipped', skipReason: 'הכתבה נמחקה מהאתר', updatedBy: staff.id })
      .where(eq(articleDrafts.publishedArticleId, id));
    await tx.update(articles).set({ draftId: null }).where(eq(articles.id, id));
    // Tags, home page slots, comments and share kits go with it.
    await tx.delete(articles).where(eq(articles.id, id));
  });
  await refreshSite(s, siteTags({ id, slug: a.slug, categories: [a.category] }));
  await audit(s.db, { userId: staff.id, entity: 'article', entityId: String(id), action: 'delete', details: { slug: a.slug } });
}
