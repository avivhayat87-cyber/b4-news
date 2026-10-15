// The editorial workflow: selections become drafts (single saved articles or a
// magazine), the AI writes a first version, editors refine it on the canvas.
import {
  type DraftDetail,
  type DraftImagesDto,
  type DraftSummary,
  type JobRef,
  type MagazineDetail,
  type MagazineSummary,
  type MissingItem,
  type PromptAuthor,
  type SavedEdits,
  type SimilarityDto,
  InvalidDocError,
  docToText,
  sanitizeDoc,
  textToDoc,
} from '@b4/shared';
import type { ManualUrlInput, ManualWriteInput, SaveSelectionInput } from '@b4/shared';
import type { z } from 'zod';
import {
  type Db,
  type ImageVariantRecord,
  aiChatMessages,
  and,
  articleDrafts,
  articles,
  asc,
  categories,
  desc,
  draftRevisions,
  eq,
  imageBatches,
  inArray,
  jobs,
  magazines,
  mediaAssets,
  ne,
  scrapedItems,
  scrapeRunItems,
  socialPackages,
  socialPlans,
  sources,
  sql,
  users,
} from '@b4/db';
import { alias } from 'drizzle-orm/pg-core';
import { AppError, errors } from '../errors';
import { ingestImage, toMediaDto } from '../lib/images';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { decodeText } from '../lib/safe-fetch';
import { compareWording } from '../lib/similarity';
import { editorGuidelinesFor } from './agent/editor';
import { lookAt, pickArticleImage, writeImagePrompts } from './agent/visual';
import { activeStyleRules, tracked, writerPrompt } from './ai';
import { imageCostUsd } from './ai/prices';
import type { ImageReference } from './ai/types';
import type { Services } from './context';
import { deskPlanDto, queueDeskPlan } from './front-page';
import { findPublicPhoto } from './public-photos';
import { canonicalUrl, sha256 } from './scraper/collect';
import { extractArticle } from './scraper/parse';
import { reviewOnFinalize, reviewProblems } from './legal-review';
import { planOnFinalize, requestPlan } from './social-plan';
import { draftReference, finalBrief, imageBrief, imageErrorMessage, sourceImageReference } from './image-brief';
import { detectLanguage, translateFullItem } from './translate';

export type DraftRow = typeof articleDrafts.$inferSelect;
type Staff = { id: string; fullName: string };

const EDITABLE = ['editing', 'ai_failed'] as const;
const AI_BUSY = ['queued_ai', 'ai_processing'] as const;

export const draftErrors = {
  aiBusy: () => new AppError(409, 'ai_busy', 'ה-AI עובד על הכתבה הזאת עכשיו. חכו כמה שניות.'),
  textLocked: () => new AppError(409, 'text_locked', 'הטקסט סומן כסופי. פתחו אותו לעריכה כדי לשנות.'),
  published: () => new AppError(409, 'already_published', 'הכתבה כבר פורסמה.'),
  conflict: (version: number) =>
    Object.assign(new AppError(409, 'version_conflict', 'מישהו אחר שמר גרסה חדשה של הכתבה. רעננו כדי לראות אותה.'), { version }),
};

const PUBLISHABLE = ['text_final', 'ready'];

/**
 * What a draft still needs before it is published, in the order an editor fixes it (the CMS takes
 * them straight to each). A main image that is still a quick draft doesn't stop it: the final
 * approval draws it at full quality first.
 * reviews: what the legal review still waits for, per draft (reviewProblems in legal-review.ts).
 * draftHeroes: quick drafts that do stop it (an article already on the site, updated in place).
 */
export function missingOf(
  d: Pick<DraftRow, 'id' | 'status' | 'title' | 'categoryId' | 'heroMediaId'> & { bodyText?: string; bodyLength?: number },
  reviews: ReadonlyMap<string, string> = new Map(),
  draftHeroes: ReadonlySet<string> = new Set(),
): MissingItem[] {
  if (d.status === 'skipped' || d.status === 'published') return [];
  const m: MissingItem[] = [];
  if (d.title.trim().length < 5) m.push({ key: 'title', message: 'חסרה כותרת' });
  if ((d.bodyLength ?? d.bodyText?.trim().length ?? 0) < 100) m.push({ key: 'body', message: 'גוף הכתבה קצר מדי' });
  if (!d.categoryId) m.push({ key: 'category', message: 'לא נבחרה קטגוריה' });
  if (!d.heroMediaId) m.push({ key: 'image', message: 'לא נבחרה תמונה ראשית' });
  else if (draftHeroes.has(d.heroMediaId)) m.push({ key: 'image', message: 'התמונה הראשית עוד בהכנה באיכות מלאה' });
  if (!PUBLISHABLE.includes(d.status)) m.push({ key: 'text', message: 'הטקסט עוד לא אושר' });
  else if (reviews.has(d.id)) m.push({ key: 'review', message: reviews.get(d.id)! });
  return m;
}

export async function categoryIdOf(db: Db, slug: string | null | undefined): Promise<number | null> {
  if (!slug) return null;
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
  if (!row) throw new AppError(400, 'bad_category', 'קטגוריה לא מוכרת');
  return row.id;
}

export async function loadDraft(db: Db, id: string): Promise<DraftRow> {
  const [row] = await db.select().from(articleDrafts).where(eq(articleDrafts.id, id)).limit(1);
  if (!row) throw errors.notFound('הכתבה');
  return row;
}

function defaultMagazineTitle(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `מגזין ${fmt.format(now)}`;
}

async function queueRewrite(db: Db, draftId: string, staffId: string | null) {
  await db.update(articleDrafts).set({ status: 'queued_ai' }).where(eq(articleDrafts.id, draftId));
  await enqueue(db, 'draft.rewrite', { draftId }, { draftId, createdBy: staffId });
}

// ---------------------------------------------------------------------------
// Creating drafts
// ---------------------------------------------------------------------------
/**
 * A selection becomes drafts: one per item, except a same-story group (stories), which becomes one
 * draft written from all its sources, at the place of its first item.
 */
export async function createDraftsFromItems(s: Services, staff: Staff, input: Omit<SaveSelectionInput, 'stories'> & { stories?: string[][] }) {
  const items = await s.db
    .select({ id: scrapedItems.id, title: scrapedItems.title, categoryId: scrapedItems.categoryId, status: scrapedItems.status })
    .from(scrapedItems)
    .where(inArray(scrapedItems.id, input.itemIds));
  const usable = [...new Set(input.itemIds)].map((id) => items.find((i) => i.id === id)).filter((i) => i && i.status !== 'in_draft') as typeof items;
  if (usable.length === 0) throw new AppError(409, 'nothing_to_save', 'הכתבות שנבחרו כבר נמצאות בעריכה.');
  // Each usable item in at most one story; a story left with one item is a single article.
  const storyOf = new Map<string, string[]>();
  for (const story of input.stories ?? []) {
    const members = [...new Set(story)].filter((id) => usable.some((i) => i.id === id) && !storyOf.has(id));
    if (members.length < 2) continue;
    for (const id of members) storyOf.set(id, members);
  }
  const drafts = usable.filter((i) => (storyOf.get(i.id)?.[0] ?? i.id) === i.id);

  let magazineId: string | null = null;
  if (input.mode === 'magazine') {
    const [run] = await s.db
      .select({ runId: scrapeRunItems.runId })
      .from(scrapeRunItems)
      .where(eq(scrapeRunItems.itemId, usable[0]!.id))
      .orderBy(desc(scrapeRunItems.addedAt))
      .limit(1);
    const [mag] = await s.db
      .insert(magazines)
      .values({ title: input.title ?? defaultMagazineTitle(), status: 'editing', createdBy: staff.id, fromRunId: run?.runId ?? null })
      .returning({ id: magazines.id });
    magazineId = mag!.id;
  }

  const draftIds: string[] = [];
  for (const [position, item] of drafts.entries()) {
    const [draft] = await s.db
      .insert(articleDrafts)
      .values({
        magazineId,
        position,
        origin: 'scraped',
        scrapedItemId: item.id,
        extraItemIds: storyOf.get(item.id)?.slice(1) ?? [],
        status: 'queued_ai',
        colorLabel: input.mode === 'single' ? (input.colorLabel ?? 'blue') : null,
        title: item.title,
        categoryId: item.categoryId,
        createdBy: staff.id,
        updatedBy: staff.id,
      })
      .returning({ id: articleDrafts.id });
    draftIds.push(draft!.id);
    await enqueue(s.db, 'draft.rewrite', { draftId: draft!.id }, { draftId: draft!.id, createdBy: staff.id });
  }
  await s.db.update(scrapedItems).set({ status: 'in_draft' }).where(inArray(scrapedItems.id, usable.map((i) => i.id)));
  return { magazineId, draftIds };
}

export async function nextPosition(db: Db, magazineId: string | undefined): Promise<number> {
  if (!magazineId) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${articleDrafts.position}), -1)::int + 1` })
    .from(articleDrafts)
    .where(eq(articleDrafts.magazineId, magazineId));
  return row?.n ?? 0;
}

export async function assertMagazine(db: Db, magazineId: string | undefined) {
  if (!magazineId) return;
  const [mag] = await db.select({ status: magazines.status }).from(magazines).where(eq(magazines.id, magazineId)).limit(1);
  if (!mag) throw errors.notFound('המגזין');
  if (mag.status === 'published' || mag.status === 'publishing') throw new AppError(409, 'magazine_closed', 'המגזין כבר פורסם. צרו מגזין חדש.');
}

/** "Add by link": read the page, keep it as the original, let the AI rewrite it. */
export async function createFromUrl(s: Services, staff: Staff, input: z.infer<typeof ManualUrlInput>) {
  await assertMagazine(s.db, input.magazineId);
  const canonical = canonicalUrl(input.url);
  const urlHash = sha256(canonical);
  let [item] = await s.db.select({ id: scrapedItems.id, title: scrapedItems.title, categoryId: scrapedItems.categoryId }).from(scrapedItems).where(eq(scrapedItems.urlHash, urlHash)).limit(1);
  if (!item) {
    let page;
    try {
      const res = await s.fetch(input.url, { allowTypes: ['text/html', 'application/xhtml'] });
      page = extractArticle(decodeText(res), res.url);
    } catch (e) {
      s.log.warn({ url: input.url, err: e instanceof Error ? e.message : e }, 'manual url fetch failed');
      throw new AppError(422, 'fetch_failed', 'לא הצלחנו לקרוא את הכתובת. בדקו שהקישור פתוח לציבור ונסו שוב.');
    }
    if (!page.title || page.bodyText.length < 200) throw new AppError(422, 'no_article', 'לא זיהינו כתבה בעמוד הזה. אפשר להעתיק את הטקסט ולהעלות ב"כתיבה ידנית".');
    [item] = await s.db
      .insert(scrapedItems)
      .values({
        url: input.url,
        urlHash,
        title: page.title.slice(0, 500),
        intro: page.intro,
        bodyText: page.bodyText.slice(0, 100_000),
        imageUrl: page.imageUrl,
        publishedAt: page.publishedAt,
        status: 'in_draft',
        // A foreign article is translated for the editor before the rewrite.
        language: detectLanguage(`${page.title} ${page.intro ?? ''} ${page.bodyText.slice(0, 2000)}`),
      })
      .returning({ id: scrapedItems.id, title: scrapedItems.title, categoryId: scrapedItems.categoryId });
  }
  const [draft] = await s.db
    .insert(articleDrafts)
    .values({
      magazineId: input.magazineId ?? null,
      position: await nextPosition(s.db, input.magazineId),
      origin: 'manual_url',
      scrapedItemId: item!.id,
      status: 'queued_ai',
      colorLabel: input.magazineId ? null : (input.colorLabel ?? 'blue'),
      title: item!.title,
      categoryId: item!.categoryId,
      createdBy: staff.id,
      updatedBy: staff.id,
    })
    .returning({ id: articleDrafts.id });
  await enqueue(s.db, 'draft.rewrite', { draftId: draft!.id }, { draftId: draft!.id, createdBy: staff.id });
  return draft!.id;
}

/** "Write manually": the editor's own text and image; no AI rewrite. */
export async function createFromWrite(s: Services, staff: Staff, input: z.infer<typeof ManualWriteInput>) {
  await assertMagazine(s.db, input.magazineId);
  const doc = textToDoc(input.body);
  if (input.heroMediaId) {
    const [m] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, input.heroMediaId)).limit(1);
    if (!m) throw errors.notFound('התמונה');
  }
  const [draft] = await s.db
    .insert(articleDrafts)
    .values({
      magazineId: input.magazineId ?? null,
      position: await nextPosition(s.db, input.magazineId),
      origin: 'manual_write',
      status: 'editing',
      colorLabel: input.magazineId ? null : (input.colorLabel ?? 'green'),
      title: input.title,
      subtitle: input.subtitle,
      bodyDoc: doc,
      bodyText: docToText(doc),
      categoryId: await categoryIdOf(s.db, input.category),
      heroMediaId: input.heroMediaId ?? null,
      tagNames: input.tags,
      createdBy: staff.id,
      updatedBy: staff.id,
    })
    .returning({ id: articleDrafts.id });
  await s.db.insert(draftRevisions).values({
    draftId: draft!.id,
    version: 1,
    source: 'human_checkpoint',
    title: input.title,
    subtitle: input.subtitle,
    bodyDoc: doc,
    bodyText: docToText(doc),
    createdBy: staff.id,
  });
  return draft!.id;
}

// ---------------------------------------------------------------------------
// AI: first rewrite, refinements, images
// ---------------------------------------------------------------------------
export async function runRewrite(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  const draft = await loadDraft(s.db, draftId);
  if (!draft.scrapedItemId) throw new PermanentJobError('draft has no original to rewrite');
  if (draft.status === 'published') return { skipped: 'published' };
  const [item] = await s.db
    .select({ title: scrapedItems.title, intro: scrapedItems.intro, body: scrapedItems.bodyText, url: scrapedItems.url, sourceName: sources.name, language: scrapedItems.language })
    .from(scrapedItems)
    .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
    .where(eq(scrapedItems.id, draft.scrapedItemId))
    .limit(1);
  if (!item) throw new PermanentJobError('original not found');

  await s.db.update(articleDrafts).set({ status: 'ai_processing' }).where(eq(articleDrafts.id, draftId));
  // A foreign original: the editor gets it in Hebrew beside the new article. A failed translation doesn't stop the rewrite.
  if (item.language) {
    await translateFullItem(s, draft.scrapedItemId, job.createdBy, draftId).catch((e) =>
      s.log.warn({ draftId, err: e instanceof Error ? e.message : e }, 'translating the original failed'),
    );
  }
  // A story from several sites: the other originals, in the order the editor's group had them.
  const extraRows = draft.extraItemIds.length
    ? await s.db
        .select({ id: scrapedItems.id, title: scrapedItems.title, intro: scrapedItems.intro, body: scrapedItems.bodyText, url: scrapedItems.url, sourceName: sources.name, language: scrapedItems.language })
        .from(scrapedItems)
        .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
        .where(inArray(scrapedItems.id, draft.extraItemIds))
    : [];
  const extras = draft.extraItemIds.map((id) => extraRows.find((r) => r.id === id)).filter((r) => r !== undefined);
  const promptKey = extras.length ? 'rewrite.combine' : 'rewrite.system';
  const prompt = await writerPrompt(s.db, promptKey);
  // Learned house style, then the editor agent's settings (divergence, length, voice; facts always kept).
  const systemPrompt = prompt.body.replace('{{style_rules}}', `${await activeStyleRules(s.db)}\n${await editorGuidelinesFor(s.db)}`);
  const asSource = (r: NonNullable<typeof item>) => ({ title: r.title, intro: r.intro, body: r.body ?? r.intro ?? '', sourceName: r.sourceName ?? new URL(r.url).hostname.replace(/^www\./, ''), url: r.url, language: r.language });
  const textAi = await s.ai.text();
  const { result, aiJobId } = await tracked(
    s.db,
    { type: 'rewrite', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey, promptVersion: prompt.version },
    () => textAi.rewrite({ systemPrompt, source: asSource(item), ...(extras.length ? { extraSources: extras.map(asSource) } : {}) }),
  );
  const out = result.data;
  const doc = sanitizeDoc(textToDoc(out.paragraphs));
  const bodyText = docToText(doc);
  const suggestedCategoryId = out.suggested_category ? await categoryIdOf(s.db, out.suggested_category) : null;

  const [updated] = await s.db
    .update(articleDrafts)
    .set({
      title: out.title,
      subtitle: out.subtitle,
      bodyDoc: doc,
      bodyText,
      aiBaselineTitle: out.title,
      aiBaselineText: bodyText,
      aiBaselineJobId: aiJobId,
      suggestedCategoryId,
      // An item discovery left without a section ("פוליטיקה ושונות") gets one from the editor, not the
      // AI (its guess is shown as a hint). A link added by hand still takes the AI's section.
      categoryId: draft.categoryId ?? (draft.origin === 'scraped' ? null : suggestedCategoryId),
      tagNames: draft.tagNames.length ? draft.tagNames : out.suggested_tags,
      imagePrompt: out.image_prompt,
      status: 'editing',
      version: sql`${articleDrafts.version} + 1`,
    })
    .where(eq(articleDrafts.id, draftId))
    .returning({ version: articleDrafts.version });
  await s.db.insert(draftRevisions).values({
    draftId,
    version: updated!.version,
    source: 'ai_initial',
    title: out.title,
    subtitle: out.subtitle,
    bodyDoc: doc,
    bodyText,
    aiJobId,
  });

  if (s.config.ai.autoImages && !draft.heroMediaId) await requestImages(s, job.createdBy, draftId, 'article');
  // The last article of its batch written: the chief editor places the batch on the site.
  await queueDeskPlan(s, draftId, job.createdBy);
  return { version: updated!.version };
}

export async function markRewriteFailed(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  await s.db
    .update(articleDrafts)
    .set({ status: 'ai_failed' })
    .where(and(eq(articleDrafts.id, draftId), inArray(articleDrafts.status, [...AI_BUSY])));
  // The rest of its batch is still placed.
  await queueDeskPlan(s, draftId, job.createdBy).catch(() => undefined);
}

export async function retryRewrite(s: Services, staff: Staff, draftId: string) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status !== 'ai_failed' && draft.status !== 'editing') throw draftErrors.aiBusy();
  if (!draft.scrapedItemId) throw new AppError(409, 'no_original', 'לכתבה שנכתבה ידנית אין מקור לשכתוב.');
  await queueRewrite(s.db, draftId, staff.id);
}

async function activeJob(db: Db, draftId: string, kinds?: string[]): Promise<JobRef | null> {
  const [row] = await db
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, error: jobs.lastError })
    .from(jobs)
    .where(and(eq(jobs.draftId, draftId), inArray(jobs.status, ['queued', 'running']), kinds ? inArray(jobs.kind, kinds) : undefined))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return row ?? null;
}

export async function requestRefine(s: Services, staff: Staff, draftId: string, instruction: string, selection?: string) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status === 'published') throw draftErrors.published();
  if (draft.status === 'text_final') throw draftErrors.textLocked();
  if (!EDITABLE.includes(draft.status as (typeof EDITABLE)[number])) throw draftErrors.aiBusy();
  if (await activeJob(s.db, draftId, ['draft.refine', 'draft.rewrite'])) throw draftErrors.aiBusy();
  const [msg] = await s.db
    .insert(aiChatMessages)
    .values({ draftId, role: 'user', content: instruction, selection: selection ? { from: 0, to: 0, text: selection } : null, createdBy: staff.id })
    .returning({ id: aiChatMessages.id });
  return enqueue(s.db, 'draft.refine', { draftId, messageId: msg!.id, baseVersion: draft.version }, { draftId, createdBy: staff.id, maxAttempts: 2 });
}

export async function runRefine(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  const messageId = Number(job.payload.messageId);
  const draft = await loadDraft(s.db, draftId);
  const [msg] = await s.db.select().from(aiChatMessages).where(eq(aiChatMessages.id, messageId)).limit(1);
  if (!msg) throw new PermanentJobError('message not found');
  let original: string | undefined;
  if (draft.scrapedItemId) {
    // A story from several sites: every report, the main one first.
    const ids = [draft.scrapedItemId, ...draft.extraItemIds];
    const items = await s.db.select({ id: scrapedItems.id, title: scrapedItems.title, body: scrapedItems.bodyText }).from(scrapedItems).where(inArray(scrapedItems.id, ids));
    const reports = ids.map((id) => items.find((i) => i.id === id)).filter((i) => i !== undefined);
    if (reports.length) original = reports.map((item) => `${item.title}\n\n${item.body ?? ''}`.slice(0, 20_000)).join('\n\n---\n\n').slice(0, 40_000);
  }
  const textAi = await s.ai.text();
  const prompt = await writerPrompt(s.db, 'refine.system');
  const { result, aiJobId } = await tracked(s.db, { type: 'refine', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey: 'refine.system', promptVersion: prompt.version }, () =>
    textAi.refine({
      systemPrompt: prompt.body,
      styleRules: '',
      current: { title: draft.title, subtitle: draft.subtitle, body: draft.bodyText },
      instruction: msg.content,
      selection: msg.selection?.text,
      original,
    }),
  );
  const out = result.data;
  const doc = sanitizeDoc(textToDoc(out.paragraphs));
  const bodyText = docToText(doc);
  // Applied on top of whatever the editor saved meanwhile; the canvas is read-only while this runs.
  const [updated] = await s.db
    .update(articleDrafts)
    .set({ title: out.title, subtitle: out.subtitle, bodyDoc: doc, bodyText, status: 'editing', version: sql`${articleDrafts.version} + 1` })
    .where(and(eq(articleDrafts.id, draftId), inArray(articleDrafts.status, [...EDITABLE])))
    .returning({ version: articleDrafts.version });
  if (!updated) throw new PermanentJobError('the draft is no longer editable');
  const [rev] = await s.db
    .insert(draftRevisions)
    .values({ draftId, version: updated.version, source: 'ai_refine', title: out.title, subtitle: out.subtitle, bodyDoc: doc, bodyText, aiJobId })
    .returning({ id: draftRevisions.id });
  await s.db.insert(aiChatMessages).values({ draftId, role: 'assistant', content: out.reply || 'עדכנתי את הכתבה.', revisionId: rev!.id, aiJobId });
  return { version: updated.version };
}

export async function markRefineFailed(s: Services, job: JobRow, error: Error) {
  await s.db.insert(aiChatMessages).values({
    draftId: String(job.payload.draftId),
    role: 'assistant',
    content: `לא הצלחתי לבצע את הבקשה (${error.message.slice(0, 200)}). נסו שוב או נסחו אחרת.`,
  });
}

export async function requestImages(
  s: Services,
  staffId: string | null,
  draftId: string,
  purpose: 'article' | 'social',
  prompt?: string,
  opts: { useSourceImage?: boolean; retryOf?: string } = {},
) {
  const draft = await loadDraft(s.db, draftId);
  if (await activeJob(s.db, draftId, ['draft.images'])) throw new AppError(409, 'images_busy', 'התמונות עוד נוצרות. חכו רגע.');
  if (opts.retryOf) {
    // A round that failed is drawn again from the same descriptions, without asking the agent again.
    const [failed] = await s.db
      .select()
      .from(imageBatches)
      .where(and(eq(imageBatches.id, opts.retryOf), eq(imageBatches.draftId, draftId)))
      .limit(1);
    if (!failed) throw errors.notFound('סבב התמונות');
    const [batch] = await s.db
      .insert(imageBatches)
      .values({
        draftId,
        purpose: failed.purpose,
        prompt: failed.prompt,
        promptBy: failed.promptBy,
        // A real photo isn't drawn: the retry draws the styles again.
        variants: failed.variants.filter((v) => v.kind === 'drawn').map((v) => ({ ...v, mediaId: null })),
        createdBy: staffId,
      })
      .returning({ id: imageBatches.id });
    return enqueue(s.db, 'draft.images', { draftId, batchId: batch!.id, purpose: failed.purpose, useSourceImage: Boolean(opts.useSourceImage && draft.scrapedItemId) }, { draftId, createdBy: staffId, maxAttempts: 2 });
  }
  const own = prompt?.trim().slice(0, 1000);
  let promptBy: PromptAuthor | null = null;
  if (purpose === 'article') {
    // Without the editor's own description, the visual agent writes one in the job. The agent's
    // last description sent back unchanged (a retry) stays the agent's.
    const [last] = own
      ? await s.db
          .select({ prompt: imageBatches.prompt, promptBy: imageBatches.promptBy })
          .from(imageBatches)
          .where(and(eq(imageBatches.draftId, draftId), eq(imageBatches.purpose, 'article')))
          .orderBy(desc(imageBatches.createdAt))
          .limit(1)
      : [];
    promptBy = !own || (last?.promptBy === 'agent' && last.prompt === own) ? 'agent' : 'editor';
  }
  const finalPrompt = own || (purpose === 'article' ? '' : `Editorial news image for: ${draft.title}`.slice(0, 1000));
  const [batch] = await s.db.insert(imageBatches).values({ draftId, purpose, prompt: finalPrompt, promptBy, createdBy: staffId }).returning({ id: imageBatches.id });
  const useSourceImage = Boolean(opts.useSourceImage && draft.scrapedItemId);
  return enqueue(s.db, 'draft.images', { draftId, batchId: batch!.id, purpose, useSourceImage }, { draftId, createdBy: staffId, maxAttempts: 2 });
}

/** Article image options are quick drafts; the one the editor chooses is redrawn at full quality (runFinalImage). */
const ARTICLE_DRAFTS = 3;
/** A draft is shown in the CMS only: its master and a list thumbnail are enough. */
const DRAFT_RENDITIONS = ['thumb'] as const;
export const FINAL_IMAGE_JOB = 'draft.image-final';

/** A Hebrew description goes to the image model in English: all of a round's in one call (kept on the images as their prompt). */
async function toEnglishBriefs(s: Services, job: JobRow, draftId: string, descriptions: string[]): Promise<string[]> {
  const hebrew = [...new Set(descriptions.filter((d) => /[א-ת]/.test(d)))];
  if (hebrew.length === 0) return descriptions;
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'translate', provider: textAi.provider, draftId, requestedBy: job.createdBy }, () => textAi.toEnglish(hebrew));
  return descriptions.map((d) => (hebrew.includes(d) ? result.data.texts[hebrew.indexOf(d)] || d : d));
}

const PHOTO_STYLE = 'צילום אמיתי';

/**
 * An article's image options: each style of the visual agent's settings drawn once from its own
 * description (an editor's own description draws them all), and, when the story is about a public
 * figure, a real photo of them in place of the last style, with its credit. The agent then
 * recommends one, which becomes the main image unless the editor already chose one. Nothing here is
 * drawn at full quality: that waits for the final approval.
 */
async function runArticleImages(s: Services, job: JobRow, batch: typeof imageBatches.$inferSelect) {
  const imageAi = await s.ai.image('draft');
  // The images follow the article itself, not only the brief; the original's photo is used only when the editor asked.
  const draft = await loadDraft(s.db, batch.draftId);
  const reference = job.payload.useSourceImage ? await sourceImageReference(s, draft) : null;
  let variants = batch.variants;
  let figure: { he: string; en: string } | null = null;
  if (variants.length === 0) {
    if (batch.prompt) {
      variants = Array.from({ length: ARTICLE_DRAFTS }, () => ({ kind: 'drawn' as const, style: 'התיאור שלכם', prompt: batch.prompt, mediaId: null }));
    } else {
      // The visual agent describes the options (in Hebrew, shown to the editor); earlier descriptions were not what the editor wanted.
      const tried = await s.db
        .select({ prompt: imageBatches.prompt })
        .from(imageBatches)
        .where(and(eq(imageBatches.draftId, batch.draftId), eq(imageBatches.purpose, 'article'), ne(imageBatches.id, batch.id), ne(imageBatches.prompt, '')))
        .orderBy(desc(imageBatches.createdAt))
        .limit(5);
      const written = await writeImagePrompts(s, draft, { requestedBy: job.createdBy, images: reference ? [reference] : [], tried: tried.map((t) => t.prompt) });
      figure = written.publicFigure;
      variants = written.options.map((o) => ({ kind: 'drawn' as const, style: o.style, prompt: o.prompt, mediaId: null }));
      const prompt = written.options.map((o, i) => `${i + 1}. ${o.prompt}`).join('\n').slice(0, 3000);
      await s.db.update(imageBatches).set({ prompt, variants }).where(eq(imageBatches.id, batch.id));
    }
  }

  // A real photo of the person the story is about, in place of the last drawn style (free; skipped when none qualifies).
  const ids: (string | null)[] = variants.map((v) => v.mediaId);
  if (figure && !variants.some((v) => v.kind === 'photo' && v.mediaId)) {
    const photo = await findPublicPhoto(s, figure);
    if (photo) {
      // Published as it is (never redrawn): every rendition now.
      const media = await ingestImage(s.db, s.storage, photo.data, {
        kind: 'upload',
        originalUrl: photo.sourceUrl,
        alt: photo.alt,
        credit: photo.credit,
        batchId: batch.id,
        createdBy: job.createdBy,
        focalY: 0.35,
      });
      const at = Math.max(0, variants.findLastIndex((v) => v.kind === 'drawn'));
      variants = variants.map((v, i) =>
        i === at ? { kind: 'photo', style: PHOTO_STYLE, prompt: figure!.he, mediaId: media.id, credit: photo.credit, license: photo.license, sourceUrl: photo.sourceUrl } : v,
      );
      ids[at] = media.id;
    }
  }

  // Each drawn option from its own description, all at once; Google bills only the ones that came back.
  const toDraw = variants.flatMap((v, i) => (v.kind === 'drawn' && !v.mediaId ? [i] : []));
  const briefs = await toEnglishBriefs(s, job, batch.draftId, toDraw.map((i) => variants[i]!.prompt));
  if (toDraw.length) {
    const { result, aiJobId } = await tracked(
      s.db,
      {
        type: 'article_images',
        provider: imageAi.provider,
        model: imageAi.model,
        draftId: batch.draftId,
        requestedBy: job.createdBy,
        imageCount: toDraw.length,
        costOf: (r) => imageCostUsd(imageAi, r.images.filter(Boolean).length),
      },
      async () => {
        let firstError: unknown = null;
        const images = await Promise.all(
          briefs.map((brief) =>
            imageAi
              .generate(imageBrief(draft, brief, Boolean(reference)), { count: 1, shape: 'landscape', references: reference ? [reference] : [] })
              .then((out) => out[0] ?? null)
              .catch((e: unknown) => {
                firstError ??= e;
                return null;
              }),
          ),
        );
        if (!images.some(Boolean)) throw firstError instanceof Error ? firstError : new Error('image generation failed: no image');
        return { images };
      },
    );
    await s.db.update(imageBatches).set({ aiJobId }).where(eq(imageBatches.id, batch.id));
    for (const [n, i] of toDraw.entries()) {
      const buffer = result.images[n];
      if (!buffer) continue;
      const media = await ingestImage(s.db, s.storage, buffer, {
        kind: 'ai_preview',
        isAiGenerated: true,
        aiPrompt: briefs[n],
        batchId: batch.id,
        createdBy: job.createdBy,
        credit: 'איור: AI',
        focalY: 0.45,
        renditions: [...DRAFT_RENDITIONS],
      });
      ids[i] = media.id;
    }
  }
  variants = variants.map((v, i) => ({ ...v, mediaId: ids[i] ?? null }));
  await s.db.update(imageBatches).set({ variants }).where(eq(imageBatches.id, batch.id));

  await pickForArticle(s, job, draft, batch.id, variants);
  return { mediaIds: ids.filter(Boolean), sourceImageMissing: Boolean(job.payload.useSourceImage) && !reference };
}

/**
 * The visual agent looks at the options and recommends one. It becomes the main image (still a
 * quick draft) when the article has none, or when the main image is the agent's own earlier pick:
 * an editor's choice is never replaced. A failed look leaves the choice to the editor.
 */
async function pickForArticle(s: Services, job: JobRow, draft: DraftRow, batchId: string, variants: ImageVariantRecord[]) {
  const ready = variants.filter((v) => v.mediaId);
  if (ready.length === 0 || draft.status === 'published') return;
  try {
    const media = await s.db.select({ id: mediaAssets.id, key: mediaAssets.storageKey }).from(mediaAssets).where(inArray(mediaAssets.id, ready.map((v) => v.mediaId!)));
    const options: { mediaId: string; label: string; image: ImageReference }[] = [];
    for (const v of ready) {
      const m = media.find((x) => x.id === v.mediaId);
      const image = m ? await lookAt(await s.storage.get(m.key)) : null;
      if (image) options.push({ mediaId: v.mediaId!, label: v.kind === 'photo' ? `${PHOTO_STYLE} של ${v.prompt} (${v.credit ?? ''})` : `מצויר, בסגנון: ${v.style}`, image });
    }
    const pick = await pickArticleImage(s, draft, { requestedBy: job.createdBy, options });
    if (!pick) return;
    const chosen = options[pick.index]!;
    await s.db.update(imageBatches).set({ pick: { mediaId: chosen.mediaId, reason: pick.reason } }).where(eq(imageBatches.id, batchId));
    const earlierPicks = await s.db
      .select({ pick: imageBatches.pick })
      .from(imageBatches)
      .where(and(eq(imageBatches.draftId, draft.id), eq(imageBatches.purpose, 'article'), ne(imageBatches.id, batchId)));
    const current = (await loadDraft(s.db, draft.id)).heroMediaId;
    const agentsOwn = current !== null && earlierPicks.some((b) => b.pick?.mediaId === current);
    if (current === null || agentsOwn) {
      await s.db
        .update(articleDrafts)
        .set({ heroMediaId: chosen.mediaId })
        .where(and(eq(articleDrafts.id, draft.id), current === null ? sql`${articleDrafts.heroMediaId} is null` : eq(articleDrafts.heroMediaId, current), ne(articleDrafts.status, 'published')));
    }
  } catch (e) {
    s.log.warn({ draftId: draft.id, err: e instanceof Error ? e.message : e }, 'the visual agent could not pick an image');
  }
}

export async function runImages(s: Services, job: JobRow) {
  const batchId = String(job.payload.batchId);
  const purpose = job.payload.purpose === 'social' ? 'social' : 'article';
  const [batch] = await s.db.select().from(imageBatches).where(eq(imageBatches.id, batchId)).limit(1);
  if (!batch) throw new PermanentJobError('batch not found');
  if (purpose === 'article') return runArticleImages(s, job, batch);
  // Story images: two portrait options from one brief, the first preselected.
  const count = 2;
  const imageAi = await s.ai.image('final');
  const draft = await loadDraft(s.db, batch.draftId);
  const reference = job.payload.useSourceImage ? await sourceImageReference(s, draft) : null;
  const description = batch.prompt;
  const [brief = description] = await toEnglishBriefs(s, job, batch.draftId, [description]);
  const prompt = imageBrief(draft, brief, Boolean(reference));
  const { result, aiJobId } = await tracked(
    s.db,
    {
      type: 'social_image',
      provider: imageAi.provider,
      model: imageAi.model,
      draftId: batch.draftId,
      requestedBy: job.createdBy,
      imageCount: count,
      // Google bills the images that came back (some of a batch may fail).
      costOf: (r) => imageCostUsd(imageAi, r.images.length),
    },
    async () => ({ images: await imageAi.generate(prompt, { count, shape: 'portrait', references: reference ? [reference] : [] }) }),
  );
  await s.db.update(imageBatches).set({ aiJobId }).where(eq(imageBatches.id, batchId));
  const ids: string[] = [];
  for (const buffer of result.images) {
    const media = await ingestImage(s.db, s.storage, buffer, { kind: 'ai_social', isAiGenerated: true, aiPrompt: brief, batchId, createdBy: job.createdBy, credit: 'איור: AI', focalY: 0.5 });
    ids.push(media.id);
  }
  // The first story image is preselected; the editor can pick the other one, ask again or upload.
  if (ids[0]) {
    await s.db
      .update(socialPackages)
      .set({ imageMediaId: ids[0], approvedAt: null, version: sql`${socialPackages.version} + 1` })
      .where(and(eq(socialPackages.draftId, batch.draftId), sql`${socialPackages.imageMediaId} is null`));
  }
  return { mediaIds: ids, sourceImageMissing: Boolean(job.payload.useSourceImage) && !reference };
}

/** Queues the full-quality version of a chosen draft, unless it is already being made. */
async function requestFinalImage(s: Services, staffId: string, draftId: string, previewId: string) {
  const [pending] = await s.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.draftId, draftId), eq(jobs.kind, FINAL_IMAGE_JOB), inArray(jobs.status, ['queued', 'running']), sql`${jobs.payload}->>'previewId' = ${previewId}`))
    .limit(1);
  if (!pending) await enqueue(s.db, FINAL_IMAGE_JOB, { draftId, previewId }, { draftId, createdBy: staffId, maxAttempts: 2 });
}

/** The chosen draft, redrawn by the full-quality model and cut into every rendition; it then replaces the draft as the main image. */
export async function runFinalImage(s: Services, job: JobRow) {
  const mediaId = await finishHeroImage(s, String(job.payload.draftId), String(job.payload.previewId), job.createdBy);
  return { mediaId };
}

/**
 * Draws a chosen quick draft at full quality (once: a version made before is reused) and puts it in
 * the draft's place as its main image, if the draft still has it. The final approval calls it for
 * every main image that is still a draft; an article already on the site, when its image changes.
 */
export async function finishHeroImage(s: Services, draftId: string, previewId: string, staffId: string | null): Promise<string> {
  const [preview] = await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, previewId)).limit(1);
  if (!preview) throw new PermanentJobError('draft image not found');
  // Chosen again after it was made (e.g. on a retry): reuse it rather than pay twice.
  let [final] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.derivedFromId, previewId)).limit(1);
  if (!final) {
    const imageAi = await s.ai.image('final');
    const reference = await draftReference(s, preview.storageKey);
    const { result } = await tracked(
      s.db,
      { type: 'article_images', provider: imageAi.provider, model: imageAi.model, draftId, requestedBy: staffId, imageCount: 1, costOf: () => imageCostUsd(imageAi, 1) },
      async () => ({ image: await imageAi.finish(finalBrief(preview.aiPrompt ?? ''), reference, 'landscape') }),
    );
    // The editor may have moved the focal point on the draft while this ran.
    const [focal] = await s.db.select({ x: mediaAssets.focalX, y: mediaAssets.focalY }).from(mediaAssets).where(eq(mediaAssets.id, previewId)).limit(1);
    final = await ingestImage(s.db, s.storage, result.image, {
      kind: 'ai_article',
      isAiGenerated: true,
      aiPrompt: preview.aiPrompt,
      batchId: preview.generationBatchId,
      derivedFromId: previewId,
      createdBy: staffId,
      alt: preview.altText,
      credit: preview.credit,
      focalX: focal?.x ?? preview.focalX,
      focalY: focal?.y ?? preview.focalY,
    });
  }
  // Only while the draft is still the chosen image: the editor may have picked another one meanwhile.
  await s.db
    .update(articleDrafts)
    .set({ heroMediaId: final.id })
    .where(and(eq(articleDrafts.id, draftId), eq(articleDrafts.heroMediaId, previewId), ne(articleDrafts.status, 'published')));
  return final.id;
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------
const REVISION_EVERY_MS = 5 * 60_000;

export async function autosave(s: Services, staff: Staff, draftId: string, input: { version: number; title: string; subtitle: string; bodyDoc?: unknown; checkpoint: boolean }) {
  let doc;
  try {
    doc = sanitizeDoc(input.bodyDoc);
  } catch (e) {
    if (e instanceof InvalidDocError) throw new AppError(400, 'bad_document', 'תוכן הכתבה לא תקין או ארוך מדי.');
    throw e;
  }
  const bodyText = docToText(doc);
  const [updated] = await s.db
    .update(articleDrafts)
    .set({ title: input.title.trim(), subtitle: input.subtitle.trim(), bodyDoc: doc, bodyText, status: 'editing', version: sql`${articleDrafts.version} + 1`, updatedBy: staff.id })
    .where(and(eq(articleDrafts.id, draftId), eq(articleDrafts.version, input.version), inArray(articleDrafts.status, [...EDITABLE])))
    .returning({ version: articleDrafts.version, updatedAt: articleDrafts.updatedAt });

  if (!updated) {
    const draft = await loadDraft(s.db, draftId);
    if (draft.status === 'published') throw draftErrors.published();
    if (draft.status === 'text_final') throw draftErrors.textLocked();
    if (AI_BUSY.includes(draft.status as (typeof AI_BUSY)[number])) throw draftErrors.aiBusy();
    if (draft.status === 'skipped') throw new AppError(409, 'skipped', 'הכתבה סומנה כ"לא לפרסם". החזירו אותה כדי לערוך.');
    throw draftErrors.conflict(draft.version);
  }

  const [last] = await s.db
    .select({ createdAt: draftRevisions.createdAt, source: draftRevisions.source })
    .from(draftRevisions)
    .where(eq(draftRevisions.draftId, draftId))
    .orderBy(desc(draftRevisions.id))
    .limit(1);
  const due = !last || last.source !== 'human_autosave' || Date.now() - last.createdAt.getTime() > REVISION_EVERY_MS;
  if (input.checkpoint || due) {
    await s.db.insert(draftRevisions).values({
      draftId,
      version: updated.version,
      source: input.checkpoint ? 'human_checkpoint' : 'human_autosave',
      title: input.title,
      subtitle: input.subtitle,
      bodyDoc: doc,
      bodyText,
      createdBy: staff.id,
    });
  }
  return { version: updated.version, savedAt: updated.updatedAt.toISOString() };
}

export async function updateMeta(
  s: Services,
  staff: Staff,
  draftId: string,
  input: {
    category?: string | null;
    placement?: 'main' | 'trending' | 'none';
    ticker?: boolean;
    tags?: string[];
    authorId?: string | null;
    colorLabel?: DraftRow['colorLabel'];
    sendPush?: boolean;
    heroMediaId?: string | null;
    disclosure?: string;
  },
) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status === 'published') throw draftErrors.published();
  let heroMediaId = input.heroMediaId;
  let finishPreview: string | null = null;
  if (heroMediaId) {
    const [m] = await s.db.select({ id: mediaAssets.id, kind: mediaAssets.kind }).from(mediaAssets).where(eq(mediaAssets.id, heroMediaId)).limit(1);
    if (!m) throw errors.notFound('התמונה');
    if (m.kind === 'ai_preview') {
      // A quick draft: its full-quality version if that was made already. Otherwise the draft stands in, and the
      // full-quality version is drawn at the final approval, so changing the choice until then costs nothing;
      // an article already on the site has no approval to wait for, so it is drawn at once.
      const [final] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.derivedFromId, m.id)).limit(1);
      if (final) heroMediaId = final.id;
      else if (draft.publishedArticleId) finishPreview = m.id;
    }
  }
  const set: Partial<typeof articleDrafts.$inferInsert> = { updatedBy: staff.id };
  if (input.category !== undefined) set.categoryId = await categoryIdOf(s.db, input.category);
  if (input.placement !== undefined) set.placement = input.placement;
  if (input.ticker !== undefined) set.ticker = input.ticker;
  if (input.tags !== undefined) set.tagNames = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  if (input.authorId !== undefined) set.authorId = input.authorId;
  if (input.colorLabel !== undefined) set.colorLabel = input.colorLabel;
  if (input.sendPush !== undefined) set.sendPush = input.sendPush;
  if (heroMediaId !== undefined) set.heroMediaId = heroMediaId;
  if (input.disclosure !== undefined) set.disclosure = input.disclosure;
  await s.db.update(articleDrafts).set(set).where(eq(articleDrafts.id, draftId));
  if (finishPreview) await requestFinalImage(s, staff.id, draftId, finishPreview);
}

/** The originals' wording to compare with (manual drafts have none; a story from several sites has them all). */
async function originalWording(s: Services, draft: DraftRow): Promise<string | null> {
  if (!draft.scrapedItemId) return null;
  const ids = [draft.scrapedItemId, ...draft.extraItemIds];
  const items = await s.db.select({ body: scrapedItems.bodyText, intro: scrapedItems.intro, bodyHe: scrapedItems.bodyHe }).from(scrapedItems).where(inArray(scrapedItems.id, ids));
  // A translated original is compared in Hebrew: copying the translation is copying.
  return items.map((item) => item.bodyHe ?? item.body ?? item.intro ?? '').join('\n\n');
}

/** Word-for-word overlap with the original (manual drafts have none to compare with). */
export async function similarityToOriginal(s: Services, draftId: string): Promise<SimilarityDto> {
  const draft = await loadDraft(s.db, draftId);
  const original = await originalWording(s, draft);
  if (original === null) return { ratio: 0, level: 'ok', passages: [] };
  return compareWording(draft.bodyText, original);
}

/** "Accept the recommendation": the AI rewords only the passages that repeat the original, keeping the facts. */
export async function requestCopyRewrite(s: Services, staff: Staff, draftId: string) {
  const draft = await loadDraft(s.db, draftId);
  const original = await originalWording(s, draft);
  const check = original === null ? null : compareWording(draft.bodyText, original, { fullPassages: true });
  if (!check || check.level === 'ok' || check.passages.length === 0) throw new AppError(409, 'nothing_to_rewrite', 'אין בכתבה קטעים שחוזרים על נוסח המקור.');
  const instruction = [
    'נסח מחדש, במילים שלנו, את הקטעים הבאים. הם חוזרים מילה במילה על נוסח המקור.',
    'שמור על כל העובדות, המספרים והשמות. ציטוט ישיר של אדם נשאר ציטוט, במירכאות ועם ייחוס. שנה את מבנה המשפטים ואת המילים, ואל תשנה את שאר הכתבה.',
    '',
    ...check.passages.map((p) => `- "${p}"`),
  ].join('\n');
  return requestRefine(s, staff, draftId, instruction);
}

export async function finalizeText(s: Services, staff: Staff, draftId: string) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status === 'text_final') return;
  if (!EDITABLE.includes(draft.status as (typeof EDITABLE)[number])) throw draftErrors.aiBusy();
  const problems: string[] = [];
  if (draft.title.trim().length < 5) problems.push('כותרת');
  if (draft.bodyText.trim().length < 100) problems.push('גוף הכתבה');
  if (!draft.categoryId) problems.push('קטגוריה');
  if (problems.length) throw new AppError(422, 'incomplete', `חסר: ${problems.join(', ')}`);
  await s.db.update(articleDrafts).set({ status: 'text_final', textFinalizedAt: new Date(), updatedBy: staff.id }).where(eq(articleDrafts.id, draftId));
  // The legal reviewer reads the final text, and the social editor writes the distribution plan from it.
  await reviewOnFinalize(s, staff, draftId);
  await planOnFinalize(s, staff, draftId);
}

type FinalEdit = { where: 'title' | 'subtitle' | 'body'; before: string; after: string } | { append: string };

/**
 * A change to a final text that an editor approved in the legal review (a safer wording of a
 * passage, or the response of the person concerned): the text stays final, a revision is kept,
 * and the distribution plan is written again from the new text. False when the passage isn't
 * in the text any more.
 */
export async function amendFinalText(s: Services, staffId: string, draftId: string, edit: FinalEdit): Promise<boolean> {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status !== 'text_final' && draft.status !== 'ready') throw draftErrors.textLocked();
  let { title, subtitle } = draft;
  const doc = sanitizeDoc(draft.bodyDoc);
  if ('append' in edit) {
    doc.content.push(...textToDoc(edit.append).content);
  } else if (edit.where === 'title' || edit.where === 'subtitle') {
    const text = edit.where === 'title' ? title : subtitle;
    if (!text.includes(edit.before)) return false;
    if (edit.where === 'title') title = text.replace(edit.before, edit.after);
    else subtitle = text.replace(edit.before, edit.after);
  } else {
    // Only the block that holds the passage is rebuilt (it keeps its kind: paragraph, sub-heading, quote, list).
    const at = doc.content.findIndex((b) => docToText({ type: 'doc', content: [b] }).includes(edit.before));
    if (at < 0) return false;
    const block = docToText({ type: 'doc', content: [doc.content[at]!] });
    doc.content.splice(at, 1, ...textToDoc(block.replace(edit.before, edit.after)).content);
  }
  const bodyDoc = sanitizeDoc(doc);
  const bodyText = docToText(bodyDoc);
  const [updated] = await s.db
    .update(articleDrafts)
    .set({ title, subtitle, bodyDoc, bodyText, version: sql`${articleDrafts.version} + 1`, updatedBy: staffId })
    .where(and(eq(articleDrafts.id, draftId), inArray(articleDrafts.status, ['text_final', 'ready'])))
    .returning({ version: articleDrafts.version });
  if (!updated) throw draftErrors.textLocked();
  await s.db.insert(draftRevisions).values({ draftId, version: updated.version, source: 'human_checkpoint', title, subtitle, bodyDoc, bodyText, createdBy: staffId });
  // The posts may quote the old wording.
  const [plan] = await s.db.select({ appliedAt: socialPlans.appliedAt }).from(socialPlans).where(eq(socialPlans.draftId, draftId)).limit(1);
  if (plan && !plan.appliedAt) await requestPlan(s, { id: staffId }, draftId);
  return true;
}

/**
 * A research's update at the top of a draft, under "עדכון" with the date, and its sources merged
 * into the sources line at the end. A final text is reopened (it changed; it is checked again
 * when it is final). On the site nothing changes until the editor updates the article.
 */
export async function addUpdateBlock(s: Services, staff: Staff, draftId: string, paragraphs: string[], creditLine: string): Promise<void> {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status === 'text_final') await reopenText(s, staff, draftId);
  else if (draft.status !== 'editing' && draft.status !== 'ai_failed') throw new AppError(409, 'not_editable', 'אי אפשר להכניס עדכון לכתבה במצב הזה. פתחו אותה לעריכה ונסו שוב.');
  const today = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' }).format(new Date());
  const doc = sanitizeDoc(draft.bodyDoc);
  doc.content.unshift(...textToDoc([`## עדכון (${today})`, ...paragraphs]).content);
  const added = creditLine.replace(/^מקורות:\s*/, '').split(/,\s*/).filter(Boolean);
  if (added.length) {
    const at = doc.content.findLastIndex((b) => docToText({ type: 'doc', content: [b] }).trim().startsWith('מקורות:'));
    const had = at >= 0 ? docToText({ type: 'doc', content: [doc.content[at]!] }).trim().replace(/^מקורות:\s*/, '').split(/,\s*/).filter(Boolean) : [];
    const line = textToDoc([`מקורות: ${[...new Set([...had, ...added])].join(', ')}`]).content;
    if (at >= 0) doc.content.splice(at, 1, ...line);
    else doc.content.push(...line);
  }
  const bodyDoc = sanitizeDoc(doc);
  const bodyText = docToText(bodyDoc);
  const [updated] = await s.db
    .update(articleDrafts)
    .set({ bodyDoc, bodyText, version: sql`${articleDrafts.version} + 1`, updatedBy: staff.id })
    .where(eq(articleDrafts.id, draftId))
    .returning({ version: articleDrafts.version, title: articleDrafts.title, subtitle: articleDrafts.subtitle });
  await s.db.insert(draftRevisions).values({ draftId, version: updated!.version, source: 'ai_refine', title: updated!.title, subtitle: updated!.subtitle, bodyDoc, bodyText, createdBy: staff.id });
}

export async function reopenText(s: Services, staff: Staff, draftId: string) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status !== 'text_final') return;
  await s.db.update(articleDrafts).set({ status: 'editing', textFinalizedAt: null, updatedBy: staff.id }).where(eq(articleDrafts.id, draftId));
  await s.db.update(socialPackages).set({ isStale: true, approvedAt: null, approvedBy: null }).where(and(eq(socialPackages.draftId, draftId), ne(socialPackages.caption, '')));
  await s.db.update(socialPlans).set({ isStale: true }).where(and(eq(socialPlans.draftId, draftId), ne(socialPlans.headline, '')));
}

export async function skipDraft(s: Services, staff: Staff, draftId: string, reason?: string) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status === 'published') throw draftErrors.published();
  await s.db.update(articleDrafts).set({ status: 'skipped', skipReason: reason ?? null, updatedBy: staff.id }).where(eq(articleDrafts.id, draftId));
}

export async function unskipDraft(s: Services, staff: Staff, draftId: string) {
  const draft = await loadDraft(s.db, draftId);
  if (draft.status !== 'skipped') return;
  const status = draft.textFinalizedAt ? 'text_final' : draft.aiBaselineText || draft.origin === 'manual_write' ? 'editing' : 'ai_failed';
  await s.db.update(articleDrafts).set({ status, skipReason: null, updatedBy: staff.id }).where(eq(articleDrafts.id, draftId));
}

export async function restoreRevision(s: Services, staff: Staff, draftId: string, revisionId: number) {
  const [rev] = await s.db.select().from(draftRevisions).where(and(eq(draftRevisions.id, revisionId), eq(draftRevisions.draftId, draftId))).limit(1);
  if (!rev) throw errors.notFound('הגרסה');
  const draft = await loadDraft(s.db, draftId);
  return autosave(s, staff, draftId, { version: draft.version, title: rev.title, subtitle: rev.subtitle, bodyDoc: rev.bodyDoc, checkpoint: true });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const updater = alias(users, 'updater');

function summaryQuery(db: Db) {
  return db
    .select({
      id: articleDrafts.id,
      title: articleDrafts.title,
      status: articleDrafts.status,
      origin: articleDrafts.origin,
      colorLabel: articleDrafts.colorLabel,
      category: categories.slug,
      placement: articleDrafts.placement,
      ticker: articleDrafts.ticker,
      stuckAt: articleDrafts.stuckAt,
      // What missingOf reads, without the whole text.
      categoryId: articleDrafts.categoryId,
      heroMediaId: articleDrafts.heroMediaId,
      bodyLength: sql<number>`length(btrim(${articleDrafts.bodyText}))::int`,
      sourceName: sources.name,
      itemUrl: scrapedItems.url,
      thumbKey: sql<string | null>`${mediaAssets.variants}->>'thumb'`,
      magazineId: magazines.id,
      magazineTitle: magazines.title,
      position: articleDrafts.position,
      updatedAt: articleDrafts.updatedAt,
      updatedBy: updater.fullName,
    })
    .from(articleDrafts)
    .leftJoin(categories, eq(articleDrafts.categoryId, categories.id))
    .leftJoin(scrapedItems, eq(articleDrafts.scrapedItemId, scrapedItems.id))
    .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
    .leftJoin(mediaAssets, eq(articleDrafts.heroMediaId, mediaAssets.id))
    .leftJoin(magazines, eq(articleDrafts.magazineId, magazines.id))
    .leftJoin(updater, eq(articleDrafts.updatedBy, updater.id))
    .$dynamic();
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaryQuery>['execute']>>[number];

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function toSummary(s: Services, r: SummaryRow, reviews: ReadonlyMap<string, string>): DraftSummary {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    origin: r.origin,
    colorLabel: r.colorLabel,
    category: r.category,
    placement: r.placement,
    ticker: r.ticker,
    missing: missingOf(r, reviews),
    stuckAt: r.stuckAt && r.status !== 'published' && r.status !== 'skipped' ? r.stuckAt.toISOString() : null,
    sourceName: r.sourceName ?? hostOf(r.itemUrl),
    thumbUrl: r.thumbKey ? s.storage.url(r.thumbKey) : null,
    magazine: r.magazineId && r.magazineTitle ? { id: r.magazineId, title: r.magazineTitle } : null,
    position: r.position,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  };
}

export async function listSaved(s: Services): Promise<SavedEdits> {
  const mags = await s.db
    .select({ id: magazines.id, title: magazines.title, status: magazines.status, createdBy: users.fullName, createdAt: magazines.createdAt, updatedAt: magazines.updatedAt, publishedAt: magazines.publishedAt })
    .from(magazines)
    .innerJoin(users, eq(magazines.createdBy, users.id))
    .where(ne(magazines.status, 'archived'))
    .orderBy(desc(magazines.updatedAt))
    .limit(100);
  const drafts = mags.length ? await summaryQuery(s.db).where(inArray(articleDrafts.magazineId, mags.map((m) => m.id))).orderBy(asc(articleDrafts.position)) : [];
  const singles = await summaryQuery(s.db)
    .where(and(sql`${articleDrafts.magazineId} is null`, ne(articleDrafts.status, 'published')))
    .orderBy(desc(articleDrafts.updatedAt))
    .limit(300);
  // Held back when their magazine was published: the oldest first, until each is published or set aside.
  const stuck = await summaryQuery(s.db)
    .where(and(sql`${articleDrafts.stuckAt} is not null`, inArray(articleDrafts.status, ['queued_ai', 'ai_processing', 'ai_failed', 'editing', 'text_final', 'ready'])))
    .orderBy(asc(articleDrafts.stuckAt))
    .limit(200);
  const reviews = await reviewProblems(s.db, [...new Set([...singles, ...stuck].map((r) => r.id))]);
  return {
    magazines: mags.map((m) => toMagazineSummary(s, m, drafts.filter((d) => d.magazineId === m.id))),
    singles: singles.map((r) => toSummary(s, r, reviews)),
    stuck: stuck.map((r) => toSummary(s, r, reviews)),
  };
}

type MagRow = { id: string; title: string; status: MagazineSummary['status']; createdBy: string; createdAt: Date; updatedAt: Date; publishedAt: Date | null };

function toMagazineSummary(s: Services, m: MagRow, drafts: SummaryRow[]): MagazineSummary {
  const count = (pred: (d: SummaryRow) => boolean) => drafts.filter(pred).length;
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    createdBy: m.createdBy,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    publishedAt: m.publishedAt?.toISOString() ?? null,
    counts: {
      total: drafts.length,
      ready: count((d) => d.status === 'text_final' || d.status === 'ready'),
      skipped: count((d) => d.status === 'skipped'),
      published: count((d) => d.status === 'published'),
      working: count((d) => ['queued_ai', 'ai_processing', 'ai_failed', 'editing'].includes(d.status)),
    },
    thumbs: drafts.flatMap((d) => (d.thumbKey ? [s.storage.url(d.thumbKey)] : [])).slice(0, 4),
  };
}

export async function summariesFor(s: Services, ids: string[]): Promise<DraftSummary[]> {
  if (ids.length === 0) return [];
  const [rows, reviews] = await Promise.all([summaryQuery(s.db).where(inArray(articleDrafts.id, ids)), reviewProblems(s.db, ids)]);
  return rows.map((r) => toSummary(s, r, reviews));
}

export async function magazineDetail(s: Services, id: string): Promise<MagazineDetail> {
  const [m] = await s.db
    .select({ id: magazines.id, title: magazines.title, status: magazines.status, createdBy: users.fullName, createdAt: magazines.createdAt, updatedAt: magazines.updatedAt, publishedAt: magazines.publishedAt })
    .from(magazines)
    .innerJoin(users, eq(magazines.createdBy, users.id))
    .where(eq(magazines.id, id))
    .limit(1);
  if (!m) throw errors.notFound('המגזין');
  const drafts = await summaryQuery(s.db).where(eq(articleDrafts.magazineId, id)).orderBy(asc(articleDrafts.position));
  const reviews = await reviewProblems(s.db, drafts.map((d) => d.id));
  return { ...toMagazineSummary(s, m, drafts), drafts: drafts.map((d) => toSummary(s, d, reviews)) };
}

export async function draftDetail(s: Services, id: string): Promise<DraftDetail> {
  const d = await loadDraft(s.db, id);
  const suggested = alias(categories, 'suggested');
  const [ctx] = await s.db
    .select({
      category: categories.slug,
      suggested: suggested.slug,
      magazineTitle: magazines.title,
      updatedBy: updater.fullName,
      itemTitle: scrapedItems.title,
      itemIntro: scrapedItems.intro,
      itemBody: scrapedItems.bodyText,
      itemImage: scrapedItems.imageUrl,
      itemUrl: scrapedItems.url,
      itemPublishedAt: scrapedItems.publishedAt,
      itemLanguage: scrapedItems.language,
      itemTitleHe: scrapedItems.titleHe,
      itemIntroHe: scrapedItems.introHe,
      itemBodyHe: scrapedItems.bodyHe,
      sourceName: sources.name,
      articleSlug: articles.slug,
    })
    .from(articleDrafts)
    .leftJoin(categories, eq(articleDrafts.categoryId, categories.id))
    .leftJoin(suggested, eq(articleDrafts.suggestedCategoryId, suggested.id))
    .leftJoin(magazines, eq(articleDrafts.magazineId, magazines.id))
    .leftJoin(updater, eq(articleDrafts.updatedBy, updater.id))
    .leftJoin(scrapedItems, eq(articleDrafts.scrapedItemId, scrapedItems.id))
    .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
    .leftJoin(articles, eq(articleDrafts.publishedArticleId, articles.id))
    .where(eq(articleDrafts.id, id))
    .limit(1);
  const [hero] = d.heroMediaId ? await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, d.heroMediaId)).limit(1) : [];
  const extraRows = d.extraItemIds.length
    ? await s.db
        .select({ id: scrapedItems.id, title: scrapedItems.title, titleHe: scrapedItems.titleHe, url: scrapedItems.url, sourceName: sources.name, publishedAt: scrapedItems.publishedAt, language: scrapedItems.language })
        .from(scrapedItems)
        .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
        .where(inArray(scrapedItems.id, d.extraItemIds))
    : [];
  const extraSources = d.extraItemIds
    .map((x) => extraRows.find((r) => r.id === x))
    .filter((r) => r !== undefined)
    .map((r) => ({ title: r.titleHe ?? r.title, url: r.url, sourceName: r.sourceName ?? hostOf(r.url) ?? '', publishedAt: r.publishedAt?.toISOString() ?? null, language: r.language }));

  let nav: DraftDetail['nav'] = null;
  if (d.magazineId) {
    const siblings = await s.db
      .select({ id: articleDrafts.id })
      .from(articleDrafts)
      .where(eq(articleDrafts.magazineId, d.magazineId))
      .orderBy(asc(articleDrafts.position), asc(articleDrafts.createdAt));
    const index = siblings.findIndex((x) => x.id === id);
    nav = { index, total: siblings.length, prevId: siblings[index - 1]?.id ?? null, nextId: siblings[index + 1]?.id ?? null };
  }

  return {
    id: d.id,
    version: d.version,
    status: d.status,
    origin: d.origin,
    colorLabel: d.colorLabel,
    title: d.title,
    subtitle: d.subtitle,
    bodyDoc: d.bodyDoc,
    category: ctx?.category ?? null,
    suggestedCategory: ctx?.suggested ?? null,
    placement: d.placement,
    ticker: d.ticker,
    deskPlan: deskPlanDto(d.deskPlan, { placement: d.placement, ticker: d.ticker, category: ctx?.category ?? null }),
    missing: missingOf(d, await reviewProblems(s.db, [d.id])),
    stuckAt: d.stuckAt && d.status !== 'published' && d.status !== 'skipped' ? d.stuckAt.toISOString() : null,
    tags: d.tagNames,
    authorId: d.authorId,
    sendPush: d.sendPush,
    disclosure: d.disclosure,
    hero: hero ? toMediaDto(s.storage, hero) : null,
    original:
      ctx?.itemUrl && ctx.itemTitle
        ? {
            title: ctx.itemTitle,
            intro: ctx.itemIntro,
            bodyText: ctx.itemBody,
            imageUrl: ctx.itemImage,
            url: ctx.itemUrl,
            sourceName: ctx.sourceName ?? hostOf(ctx.itemUrl) ?? '',
            publishedAt: ctx.itemPublishedAt?.toISOString() ?? null,
            language: ctx.itemLanguage,
            translation: ctx.itemLanguage && ctx.itemBodyHe ? { title: ctx.itemTitleHe ?? ctx.itemTitle, intro: ctx.itemIntroHe, bodyText: ctx.itemBodyHe } : null,
          }
        : null,
    extraSources,
    hasAiBaseline: Boolean(d.aiBaselineText),
    textFinalizedAt: d.textFinalizedAt?.toISOString() ?? null,
    skipReason: d.skipReason,
    publishedArticle: d.publishedArticleId && ctx?.articleSlug ? { id: d.publishedArticleId, slug: ctx.articleSlug } : null,
    magazine: d.magazineId && ctx?.magazineTitle ? { id: d.magazineId, title: ctx.magazineTitle } : null,
    nav,
    activeJob: await activeJob(s.db, id, ['draft.rewrite', 'draft.refine']),
    updatedAt: d.updatedAt.toISOString(),
    updatedBy: ctx?.updatedBy ?? null,
  };
}

export async function chatMessages(s: Services, draftId: string) {
  const rows = await s.db.select().from(aiChatMessages).where(eq(aiChatMessages.draftId, draftId)).orderBy(asc(aiChatMessages.id)).limit(200);
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.createdAt.toISOString() }));
}

export async function imageBatchesOf(s: Services, draftId: string, purpose: 'article' | 'social') {
  const batches = await s.db
    .select()
    .from(imageBatches)
    .where(and(eq(imageBatches.draftId, draftId), eq(imageBatches.purpose, purpose)))
    .orderBy(desc(imageBatches.createdAt))
    .limit(10);
  const ids = batches.map((b) => b.id);
  const batchId = sql<string>`${jobs.payload}->>'batchId'`;
  const [media, batchJobs] = ids.length
    ? await Promise.all([
        // The options themselves; a chosen draft's full-quality version is shown as the main image instead.
        s.db
          .select()
          .from(mediaAssets)
          .where(and(inArray(mediaAssets.generationBatchId, ids), sql`${mediaAssets.derivedFromId} is null`))
          .orderBy(asc(mediaAssets.createdAt)),
        s.db
          .select({ batchId, status: jobs.status, error: jobs.lastError, result: jobs.result })
          .from(jobs)
          .where(and(eq(jobs.draftId, draftId), eq(jobs.kind, 'draft.images'), inArray(batchId, ids))),
      ])
    : [[], []];
  return batches.map((b) => {
    const job = batchJobs.find((j) => j.batchId === b.id);
    const status = job?.status === 'failed' || job?.status === 'cancelled' ? 'failed' : job?.status === 'queued' || job?.status === 'running' ? 'working' : 'done';
    // In the order of the options (the styles, then a real photo in the last style's place).
    const order = (id: string) => {
      const at = b.variants.findIndex((v) => v.mediaId === id);
      return at < 0 ? b.variants.length : at;
    };
    return {
      id: b.id,
      prompt: b.prompt,
      promptBy: (b.promptBy as PromptAuthor | null) ?? null,
      createdAt: b.createdAt.toISOString(),
      images: media
        .filter((m) => m.generationBatchId === b.id)
        .sort((x, y) => order(x.id) - order(y.id))
        .map((m) => toMediaDto(s.storage, m)),
      variants: b.variants.map((v) => ({ kind: v.kind, style: v.style, prompt: v.prompt, mediaId: v.mediaId, credit: v.credit ?? null, license: v.license ?? null, sourceUrl: v.sourceUrl ?? null })),
      pick: b.pick ?? null,
      status,
      error: status === 'failed' ? imageErrorMessage(job?.error ?? null) : null,
      note: (job?.result as { sourceImageMissing?: boolean } | null)?.sourceImageMissing ? 'לא הצלחנו לטעון את תמונת המקור, אז התמונות נוצרו בלי השראה ממנה.' : null,
    } as const;
  });
}

/** The article's image options, which one is chosen, and whether its full-quality version is still being made. */
export async function draftImages(s: Services, draftId: string): Promise<DraftImagesDto> {
  const draft = await loadDraft(s.db, draftId);
  const [batches, drawing] = await Promise.all([imageBatchesOf(s, draftId, 'article'), activeJob(s.db, draftId, ['draft.images'])]);
  const [hero] = draft.heroMediaId
    ? await s.db.select({ id: mediaAssets.id, kind: mediaAssets.kind, derivedFromId: mediaAssets.derivedFromId }).from(mediaAssets).where(eq(mediaAssets.id, draft.heroMediaId)).limit(1)
    : [];
  // A draft as the main image waits for the final approval; only an article already on the site draws it at once.
  let upgrade: DraftImagesDto['upgrade'] = null;
  if (hero?.kind === 'ai_preview') {
    const [job] = await s.db
      .select({ status: jobs.status, error: jobs.lastError })
      .from(jobs)
      .where(and(eq(jobs.draftId, draftId), eq(jobs.kind, FINAL_IMAGE_JOB), sql`${jobs.payload}->>'previewId' = ${hero.id}`))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (job) upgrade = job.status === 'queued' || job.status === 'running' ? { status: 'working', error: null } : job.status === 'failed' ? { status: 'failed', error: imageErrorMessage(job.error) } : null;
  }
  return { batches, activeJob: drawing, heroId: hero?.id ?? null, chosenId: hero ? (hero.derivedFromId ?? hero.id) : null, heroIsDraft: hero?.kind === 'ai_preview', upgrade };
}

export async function revisions(s: Services, draftId: string) {
  const rows = await s.db
    .select({ id: draftRevisions.id, version: draftRevisions.version, source: draftRevisions.source, title: draftRevisions.title, createdAt: draftRevisions.createdAt, by: users.fullName })
    .from(draftRevisions)
    .leftJoin(users, eq(draftRevisions.createdBy, users.id))
    .where(eq(draftRevisions.draftId, draftId))
    .orderBy(desc(draftRevisions.id))
    .limit(50);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
