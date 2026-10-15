// Final approval and "Publish all": the site first (articles, tags, homepage
// zones, cache revalidation, push), then the social networks, then the
// learning loop. Safe to retry: published drafts and posted posts are skipped.
import { randomBytes } from 'node:crypto';
import { type PreviewItem, type PublishJobDto, type PublishPreview, docToHtml, docToText, excerptFrom, readingMinutes, sanitizeDoc } from '@b4/shared';
import {
  type Db,
  and,
  articleDrafts,
  articles,
  asc,
  categories,
  desc,
  devices,
  eq,
  homepageSlots,
  imageBatches,
  inArray,
  magazines,
  mediaAssets,
  publishJobs,
  pushNotifications,
  scrapedItems,
  socialAccounts,
  socialPackages,
  socialPosts,
  sql,
} from '@b4/db';
import { AppError, errors } from '../errors';
import { variantUrl } from '../lib/images';
import { compareWording, similarityWarning } from '../lib/similarity';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import type { Services } from './context';
import { type DraftRow, finishHeroImage, loadDraft, missingOf, summariesFor } from './drafts';
import { deskPlanDto } from './front-page';
import { imageErrorMessage } from './image-brief';
import { queueBatchLearning, recordFeedback } from './learning';
import { queueVisualLearning, recordImageFeedback } from './agent/visual';
import { setArticleTags, updateArticleFromDraft } from './article-content';
import { type SocialPayload, publishToNetwork } from './social-adapters';
import { reviewProblems } from './legal-review';
import { applyPlan } from './social-plan';

type Staff = { id: string; fullName: string };
export type PublishTarget = { magazineId: string } | { draftId: string };

/** What a draft still needs before it is published (missingOf in drafts.ts), as the sentences the editor reads. */
export function problemsOf(
  d: Pick<DraftRow, 'id' | 'status' | 'title' | 'categoryId' | 'heroMediaId'> & { bodyText: string },
  reviews: ReadonlyMap<string, string> = new Map(),
  draftHeroes: ReadonlySet<string> = new Set(),
): string[] {
  return missingOf(d, reviews, draftHeroes).map((x) => x.message);
}

async function draftHeroesOf(db: Db, rows: DraftRow[]): Promise<Set<string>> {
  const ids = rows.flatMap((r) => (r.heroMediaId ? [r.heroMediaId] : []));
  if (ids.length === 0) return new Set();
  const media = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.kind, 'ai_preview')));
  return new Set(media.map((m) => m.id));
}

async function draftsOf(db: Db, target: PublishTarget): Promise<DraftRow[]> {
  if ('draftId' in target) return [await loadDraft(db, target.draftId)];
  return db.select().from(articleDrafts).where(eq(articleDrafts.magazineId, target.magazineId)).orderBy(asc(articleDrafts.position), asc(articleDrafts.createdAt));
}

/** Each draft's latest round of image options that has any, with the visual agent's pick: to switch the main image in the preview. */
async function latestOptions(s: Services, rows: DraftRow[]) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map<string, { options: PreviewItem['imageOptions']; reason: string | null }>();
  const batches = await s.db
    .select({ id: imageBatches.id, draftId: imageBatches.draftId, pick: imageBatches.pick, variants: imageBatches.variants })
    .from(imageBatches)
    .where(and(inArray(imageBatches.draftId, ids), eq(imageBatches.purpose, 'article')))
    .orderBy(desc(imageBatches.createdAt));
  const options = batches.length
    ? await s.db
        .select()
        .from(mediaAssets)
        .where(and(inArray(mediaAssets.generationBatchId, batches.map((b) => b.id)), sql`${mediaAssets.derivedFromId} is null`))
    : [];
  const heroes = rows.some((r) => r.heroMediaId)
    ? await s.db.select({ id: mediaAssets.id, derivedFromId: mediaAssets.derivedFromId }).from(mediaAssets).where(inArray(mediaAssets.id, rows.flatMap((r) => (r.heroMediaId ? [r.heroMediaId] : []))))
    : [];
  const out = new Map<string, { options: PreviewItem['imageOptions']; reason: string | null }>();
  for (const r of rows) {
    const batch = batches.find((b) => b.draftId === r.id && options.some((m) => m.generationBatchId === b.id));
    if (!batch) continue;
    const hero = heroes.find((h) => h.id === r.heroMediaId);
    const chosen = hero ? (hero.derivedFromId ?? hero.id) : null;
    const order = (id: string) => batch.variants.findIndex((v) => v.mediaId === id);
    out.set(r.id, {
      options: options
        .filter((m) => m.generationBatchId === batch.id)
        .sort((a, b) => order(a.id) - order(b.id))
        .map((m) => ({ id: m.id, thumbUrl: variantUrl(s.storage, m, 'thumb'), chosen: m.id === chosen, agentPick: batch.pick?.mediaId === m.id, style: batch.variants.find((v) => v.mediaId === m.id)?.style ?? null })),
      reason: batch.pick?.reason ?? null,
    });
  }
  return out;
}

export async function preview(s: Services, staff: Staff, target: PublishTarget): Promise<PublishPreview> {
  const rows = await draftsOf(s.db, target);
  const summaries = await summariesFor(s, rows.map((r) => r.id));
  const media = rows.some((r) => r.heroMediaId)
    ? await s.db.select().from(mediaAssets).where(inArray(mediaAssets.id, rows.flatMap((r) => (r.heroMediaId ? [r.heroMediaId] : []))))
    : [];
  const draftHeroes = new Set(media.filter((m) => m.kind === 'ai_preview').map((m) => m.id));
  const reviews = await reviewProblems(s.db, rows.map((r) => r.id));
  const imageOptions = await latestOptions(s, rows);
  const packages = rows.length ? await s.db.select().from(socialPackages).where(inArray(socialPackages.draftId, rows.map((r) => r.id))) : [];
  const originalIds = rows.flatMap((r) => (r.scrapedItemId ? [r.scrapedItemId] : []));
  const originals = originalIds.length
    ? await s.db.select({ id: scrapedItems.id, body: scrapedItems.bodyText, intro: scrapedItems.intro, bodyHe: scrapedItems.bodyHe }).from(scrapedItems).where(inArray(scrapedItems.id, originalIds))
    : [];
  const posts = rows.length
    ? await s.db
        .select({ draftId: socialPosts.draftId, platform: socialAccounts.platform })
        .from(socialPosts)
        .innerJoin(socialAccounts, eq(socialPosts.socialAccountId, socialAccounts.id))
        .where(and(inArray(socialPosts.draftId, rows.map((r) => r.id)), eq(socialPosts.enabled, true), eq(socialAccounts.isActive, true)))
    : [];

  const items: PreviewItem[] = rows.flatMap((r) => {
    const summary = summaries.find((x) => x.id === r.id);
    if (!summary) return [];
    const hero = media.find((m) => m.id === r.heroMediaId);
    const pkg = packages.find((p) => p.draftId === r.id);
    const original = originals.find((o) => o.id === r.scrapedItemId);
    const copied = original ? similarityWarning(compareWording(r.bodyText, original.bodyHe ?? original.body ?? original.intro ?? '')) : null;
    const missing = missingOf(r, reviews);
    const options = imageOptions.get(r.id);
    return [
      {
        draft: summary,
        subtitle: r.subtitle,
        excerpt: r.subtitle || excerptFrom(r.bodyText),
        // A quick draft has only its small rendition until the approval draws it at full quality.
        heroUrl: hero ? variantUrl(s.storage, hero, hero.kind === 'ai_preview' ? 'thumb' : 'card') : null,
        tags: r.tagNames,
        editorName: staff.fullName,
        social: { ready: Boolean(pkg?.approvedAt), platforms: posts.filter((p) => p.draftId === r.id).map((p) => p.platform) },
        problems: missing.map((m) => m.message),
        missing,
        imageOptions: options?.options ?? [],
        imagePickReason: options?.reason ?? null,
        heroIsDraft: Boolean(hero && draftHeroes.has(hero.id)),
        ticker: r.ticker,
        deskPlan: deskPlanDto(r.deskPlan, { placement: r.placement, ticker: r.ticker, category: summary.category }),
        warnings: copied && r.status !== 'published' && r.status !== 'skipped' ? [copied] : [],
      },
    ];
  });
  return {
    publishDate: new Date().toISOString(),
    editorName: staff.fullName,
    items,
    readyCount: rows.filter((r) => r.status !== 'skipped' && r.status !== 'published' && missingOf(r, reviews).length === 0).length,
    skippedCount: rows.filter((r) => r.status === 'skipped').length,
  };
}

export async function startPublish(s: Services, staff: Staff, target: PublishTarget, idempotencyKey: string): Promise<string> {
  const [existing] = await s.db.select({ id: publishJobs.id }).from(publishJobs).where(eq(publishJobs.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return existing.id;

  if ('magazineId' in target) {
    const [mag] = await s.db.select({ status: magazines.status }).from(magazines).where(eq(magazines.id, target.magazineId)).limit(1);
    if (!mag) throw errors.notFound('המגזין');
    if (mag.status === 'publishing') throw new AppError(409, 'publishing', 'המגזין כבר בתהליך פרסום.');
  }
  const rows = await draftsOf(s.db, target);
  const pending = rows.filter((r) => r.status !== 'skipped' && r.status !== 'published');
  if (pending.length === 0) throw new AppError(409, 'nothing_to_publish', 'אין כתבות שממתינות לפרסום.');
  const reviews = await reviewProblems(s.db, pending.map((r) => r.id));
  // A magazine goes out with what is ready; what isn't waits in "נתקעו בפרסום" (set by the job). One article must be ready.
  const ready = pending.filter((r) => missingOf(r, reviews).length === 0);
  if (ready.length === 0 || ('draftId' in target && ready.length < pending.length)) {
    const first = pending.find((r) => missingOf(r, reviews).length > 0)!;
    throw new AppError(
      422,
      'not_ready',
      pending.length === 1
        ? `הכתבה עוד לא מוכנה: ${problemsOf(first, reviews).join(', ')}.`
        : `אף כתבה עוד לא מוכנה (למשל "${first.title.slice(0, 40)}": ${problemsOf(first, reviews).join(', ')}). השלימו אותן או סמנו "לא לפרסם".`,
    );
  }

  const [job] = await s.db
    .insert(publishJobs)
    .values({ ...('magazineId' in target ? { magazineId: target.magazineId } : { draftId: target.draftId }), idempotencyKey, requestedBy: staff.id })
    .returning({ id: publishJobs.id });
  if ('magazineId' in target) await s.db.update(magazines).set({ status: 'publishing' }).where(eq(magazines.id, target.magazineId));
  await enqueue(s.db, 'publish.run', { publishJobId: job!.id }, { createdBy: staff.id, maxAttempts: 2 });
  return job!.id;
}

function newSlug(): string {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const rand = [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('');
  return `${ymd}-${rand}`;
}

/** New article first; pinned slots keep their position; the rest shift down and the last falls off. */
async function placeOnHomepage(db: Db, zone: 'main' | 'trending', articleId: number) {
  const max = zone === 'main' ? 7 : 14;
  const current = await db.select().from(homepageSlots).where(eq(homepageSlots.zone, zone)).orderBy(asc(homepageSlots.position));
  const pinned = new Map(current.filter((c) => c.pinned).map((c) => [c.position, c.articleId]));
  const queue = [articleId, ...current.filter((c) => !c.pinned && c.articleId !== articleId).map((c) => c.articleId)];
  const next: { zone: 'main' | 'trending'; position: number; articleId: number; pinned: boolean }[] = [];
  for (let position = 1; position <= max; position++) {
    const p = pinned.get(position);
    if (p !== undefined) next.push({ zone, position, articleId: p, pinned: true });
    else {
      const id = queue.shift();
      if (id !== undefined) next.push({ zone, position, articleId: id, pinned: false });
    }
  }
  await db.delete(homepageSlots).where(eq(homepageSlots.zone, zone));
  if (next.length) await db.insert(homepageSlots).values(next);
}

async function publishArticle(db: Db, draft: DraftRow, editorId: string): Promise<{ id: number; slug: string; category: string }> {
  return db.transaction(async (tx) => {
    const doc = sanitizeDoc(draft.bodyDoc);
    const text = docToText(doc);
    const [item] = draft.scrapedItemId
      ? await tx.select({ sourceId: scrapedItems.sourceId, url: scrapedItems.url }).from(scrapedItems).where(eq(scrapedItems.id, draft.scrapedItemId)).limit(1)
      : [];
    const [cat] = await tx.select({ slug: categories.slug }).from(categories).where(eq(categories.id, draft.categoryId!)).limit(1);
    const [article] = await tx
      .insert(articles)
      .values({
        slug: newSlug(),
        status: 'published',
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        bodyDoc: doc,
        bodyHtml: docToHtml(doc),
        excerpt: draft.subtitle.trim() || excerptFrom(text),
        categoryId: draft.categoryId!,
        authorId: draft.authorId,
        editorId,
        heroMediaId: draft.heroMediaId,
        sourceId: item?.sourceId ?? null,
        sourceUrl: item?.url ?? null,
        readingMinutes: readingMinutes(text),
        disclosure: draft.disclosure.trim() || null,
        draftId: draft.id,
        // The ticker shows the newest 12 marked: the oldest drops off by itself.
        tickerAt: draft.ticker ? new Date() : null,
      })
      .returning({ id: articles.id, slug: articles.slug });

    await setArticleTags(tx, article!.id, draft.tagNames);
    if (draft.placement !== 'none') await placeOnHomepage(tx, draft.placement, article!.id);
    await tx.update(articleDrafts).set({ status: 'published', publishedArticleId: article!.id, stuckAt: null }).where(eq(articleDrafts.id, draft.id));
    await recordFeedback(tx, draft, article!.id, editorId);
    await recordImageFeedback(tx, draft, article!.id, editorId);
    return { id: article!.id, slug: article!.slug, category: cat?.slug ?? '' };
  });
}

export async function revalidateSite(s: Services, tagList: string[]): Promise<void> {
  if (!s.config.revalidate.secret) return;
  const res = await fetch(s.config.revalidate.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-revalidate-secret': s.config.revalidate.secret },
    body: JSON.stringify({ tags: tagList }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`revalidate HTTP ${res.status}`);
}

async function sendPush(s: Services, staffId: string, article: { id: number; title: string; excerpt: string }) {
  const url = `${s.config.publicSiteUrl}/a/${article.id}`;
  const [note] = await s.db
    .insert(pushNotifications)
    .values({ articleId: article.id, title: article.title.slice(0, 120), body: article.excerpt.slice(0, 180), deepLink: url, sentBy: staffId })
    .returning({ id: pushNotifications.id });
  const tokens = (await s.db.select({ token: devices.pushToken }).from(devices).where(sql`'breaking' = any(${devices.topics})`))
    .map((d) => d.token)
    .filter((t) => /^Expo(nent)?PushToken\[/.test(t));
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100).map((to) => ({ to, title: article.title, body: article.excerpt, data: { url }, channelId: 'breaking', sound: 'default' }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`push HTTP ${res.status}`);
  }
  await s.db.update(pushNotifications).set({ status: 'succeeded', sentAt: new Date() }).where(eq(pushNotifications.id, note!.id));
  return tokens.length;
}

async function postSocial(s: Services, draft: DraftRow, articleId: number, steps: Record<string, string>) {
  const [pkg] = await s.db.select().from(socialPackages).where(eq(socialPackages.draftId, draft.id)).limit(1);
  if (!pkg?.approvedAt || !pkg.imageMediaId) return;
  const [image] = await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, pkg.imageMediaId)).limit(1);
  if (!image) return;
  const targets = await s.db
    .select({ post: socialPosts, account: socialAccounts })
    .from(socialPosts)
    .innerJoin(socialAccounts, eq(socialPosts.socialAccountId, socialAccounts.id))
    .where(and(eq(socialPosts.draftId, draft.id), eq(socialPosts.enabled, true), eq(socialAccounts.isActive, true)));
  for (const { post, account } of targets) {
    if (post.status === 'posted') continue;
    const payload: SocialPayload = {
      headline: pkg.headline,
      caption: post.captionOverride ?? pkg.caption,
      articleUrl: `${s.config.publicSiteUrl}/a/${articleId}`,
      storyImageUrl: variantUrl(s.storage, image, 'story'),
      squareImageUrl: variantUrl(s.storage, image, 'square'),
      linkInFirstComment: account.linkInFirstComment,
    };
    const key = `${draft.id}:${account.platform}:${account.displayName}`;
    try {
      const result = await publishToNetwork(s.config, account, await s.settings.socialToken(account), payload);
      await s.db
        .update(socialPosts)
        .set(
          result.status === 'posted'
            ? { status: 'posted', articleId, payload, externalPostId: result.postId, externalCommentId: result.commentId, postedAt: new Date(), attempts: sql`${socialPosts.attempts} + 1`, lastError: null }
            : { status: 'skipped', articleId, payload, lastError: result.reason },
        )
        .where(eq(socialPosts.id, post.id));
      steps[key] = result.status === 'posted' ? 'ok' : 'prepared';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await s.db
        .update(socialPosts)
        .set({ status: 'failed', articleId, payload, lastError: message.slice(0, 500), attempts: sql`${socialPosts.attempts} + 1` })
        .where(eq(socialPosts.id, post.id));
      steps[key] = `failed: ${message.slice(0, 200)}`;
    }
  }
}

export async function runPublish(s: Services, job: JobRow) {
  const publishJobId = String(job.payload.publishJobId);
  const [pj] = await s.db.select().from(publishJobs).where(eq(publishJobs.id, publishJobId)).limit(1);
  if (!pj) throw new PermanentJobError('publish job not found');
  await s.db.update(publishJobs).set({ status: 'running', startedAt: pj.startedAt ?? new Date() }).where(eq(publishJobs.id, publishJobId));
  const target: PublishTarget = pj.magazineId ? { magazineId: pj.magazineId } : { draftId: pj.draftId! };
  const steps: Record<string, string> = { ...pj.steps };
  const published: { draft: DraftRow; article: { id: number; slug: string; category: string } }[] = [];
  // Articles already on the site whose draft was edited: updated in place (no push, posts or learning again).
  const updated: { id: number; slug: string; categories: string[] }[] = [];
  // Checked again at publishing time: a decision may have changed since the job was queued.
  let rows = await draftsOf(s.db, target);
  const reviews = await reviewProblems(s.db, rows.map((r) => r.id));
  const waiting = (r: DraftRow) => r.status !== 'skipped' && r.status !== 'published';
  const stuck = new Map<string, string>();
  for (const r of rows.filter(waiting)) {
    const missing = problemsOf(r, reviews);
    if (missing.length) stuck.set(r.id, missing.join(', '));
  }

  // 0. The main images chosen as quick drafts are drawn at full quality now, all at once (paid only for what goes out).
  const draftHeroes = await draftHeroesOf(s.db, rows.filter((r) => waiting(r) && !stuck.has(r.id)));
  await Promise.all(
    rows
      .filter((r) => waiting(r) && !stuck.has(r.id) && r.heroMediaId && draftHeroes.has(r.heroMediaId))
      .map(async (r) => {
        try {
          await finishHeroImage(s, r.id, r.heroMediaId!, pj.requestedBy);
          steps[`${r.id}:image`] = 'ok';
        } catch (e) {
          steps[`${r.id}:image`] = `failed: ${imageErrorMessage(e instanceof Error ? e.message : String(e))}`;
          stuck.set(r.id, 'התמונה הראשית לא נוצרה באיכות מלאה');
        }
      }),
  );
  if (draftHeroes.size) rows = await draftsOf(s.db, target);

  // What isn't ready waits in "נתקעו בפרסום", by the time it was held.
  if (stuck.size) await s.db.update(articleDrafts).set({ stuckAt: sql`coalesce(${articleDrafts.stuckAt}, now())` }).where(inArray(articleDrafts.id, [...stuck.keys()]));

  // 1. The site.
  for (const draft of rows) {
    if (draft.status === 'skipped') continue;
    if (draft.status === 'published') {
      const [a] = await s.db.select({ id: articles.id, slug: articles.slug }).from(articles).where(eq(articles.draftId, draft.id)).limit(1);
      if (a) published.push({ draft, article: { ...a, category: '' } });
      continue;
    }
    if (stuck.has(draft.id)) {
      steps[`${draft.id}:site`] = `held: ${stuck.get(draft.id)}`;
      continue;
    }
    const late = problemsOf(draft, reviews, await draftHeroesOf(s.db, [draft]));
    if (late.length) {
      steps[`${draft.id}:site`] = `failed: ${late.join(', ')}`;
      continue;
    }
    if (draft.publishedArticleId) {
      try {
        updated.push(await s.db.transaction((tx) => updateArticleFromDraft(tx, draft, pj.requestedBy)));
        steps[`${draft.id}:site`] = 'updated';
      } catch (e) {
        steps[`${draft.id}:site`] = `failed: ${e instanceof Error ? e.message : e}`;
      }
      await s.db.update(publishJobs).set({ steps }).where(eq(publishJobs.id, publishJobId));
      continue;
    }
    try {
      const article = await publishArticle(s.db, draft, pj.requestedBy);
      steps[`${draft.id}:site`] = 'ok';
      published.push({ draft, article });
      if (draft.sendPush) {
        try {
          const n = await sendPush(s, pj.requestedBy, { id: article.id, title: draft.title, excerpt: draft.subtitle || excerptFrom(draft.bodyText) });
          steps[`${draft.id}:push`] = `ok (${n})`;
        } catch (e) {
          steps[`${draft.id}:push`] = `failed: ${e instanceof Error ? e.message : e}`;
        }
      }
    } catch (e) {
      steps[`${draft.id}:site`] = `failed: ${e instanceof Error ? e.message : e}`;
      s.log.error({ draft: draft.id, err: e instanceof Error ? e.message : e }, 'publish article failed');
    }
    await s.db.update(publishJobs).set({ steps }).where(eq(publishJobs.id, publishJobId));
  }

  try {
    const tagList = new Set(['home', 'search']);
    for (const { article } of published) {
      tagList.add(`article:${article.id}`);
      tagList.add(`article-slug:${article.slug}`);
      if (article.category) tagList.add(`category:${article.category}`);
    }
    for (const article of updated) {
      tagList.add(`article:${article.id}`);
      tagList.add(`article-slug:${article.slug}`);
      for (const c of article.categories) tagList.add(`category:${c}`);
    }
    if (published.length || updated.length) await revalidateSite(s, [...tagList]);
    steps.revalidate = 'ok';
  } catch (e) {
    steps.revalidate = `failed: ${e instanceof Error ? e.message : e}`;
  }

  // 2. Social networks (only after the site is live): the distribution plan, or else the editor's older social package.
  for (const { draft, article } of published) {
    try {
      const plan = await applyPlan(s, draft.id, article.id, pj.requestedBy);
      if (plan.handled) {
        if (!plan.already) steps[`${draft.id}:social`] = plan.posts || plan.reel ? `plan: ${plan.posts} posts${plan.reel ? ', reel started' : ''}` : 'plan: kept on the social page';
        continue;
      }
    } catch (e) {
      steps[`${draft.id}:social`] = `failed: ${e instanceof Error ? e.message : e}`;
      continue;
    }
    await postSocial(s, draft, article.id, steps);
  }

  // 3. The learning loop: the whole batch in one learning pass; the visual agent learns every few cases.
  if (published.length) {
    await queueBatchLearning(s, publishJobId, pj.requestedBy).catch(() => undefined);
    await queueVisualLearning(s, pj.requestedBy).catch(() => undefined);
  }

  const siteFailures = Object.entries(steps).filter(([k, v]) => k.endsWith(':site') && v.startsWith('failed')).length;
  // An article that failed at the last moment waits with the ones held back.
  const failedIds = Object.entries(steps).flatMap(([k, v]) => (k.endsWith(':site') && v.startsWith('failed') ? [k.split(':')[0]!] : []));
  if (failedIds.length) await s.db.update(articleDrafts).set({ stuckAt: sql`coalesce(${articleDrafts.stuckAt}, now())` }).where(inArray(articleDrafts.id, failedIds));
  const status = siteFailures && !published.length && !updated.length ? 'failed' : 'succeeded';
  await s.db
    .update(publishJobs)
    .set({
      status,
      steps,
      finishedAt: new Date(),
      error: siteFailures ? `${siteFailures} כתבות לא פורסמו` : stuck.size ? `${stuck.size} כתבות נתקעו ומחכות ב"נתקעו בפרסום"` : null,
    })
    .where(eq(publishJobs.id, publishJobId));
  if (pj.magazineId) {
    await s.db
      .update(magazines)
      .set({ status: siteFailures ? 'partially_failed' : 'published', publishedAt: new Date() })
      .where(eq(magazines.id, pj.magazineId));
  }
  return { published: published.length, updated: updated.length, siteFailures };
}

export async function markPublishFailed(s: Services, job: JobRow, error: Error) {
  const id = String(job.payload.publishJobId);
  const [pj] = await s.db.update(publishJobs).set({ status: 'failed', error: error.message.slice(0, 500), finishedAt: new Date() }).where(eq(publishJobs.id, id)).returning();
  if (pj?.magazineId) await s.db.update(magazines).set({ status: 'partially_failed' }).where(and(eq(magazines.id, pj.magazineId), eq(magazines.status, 'publishing')));
}

export async function publishJobDto(s: Services, id: string): Promise<PublishJobDto> {
  const [pj] = await s.db.select().from(publishJobs).where(eq(publishJobs.id, id)).limit(1);
  if (!pj) throw errors.notFound('תהליך הפרסום');
  return {
    id: pj.id,
    status: pj.status,
    steps: pj.steps,
    error: pj.error,
    createdAt: pj.createdAt.toISOString(),
    finishedAt: pj.finishedAt?.toISOString() ?? null,
  };
}
