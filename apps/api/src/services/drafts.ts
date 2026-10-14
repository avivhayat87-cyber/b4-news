// The editorial workflow: selections become drafts (single saved articles or a
// magazine), the AI writes a first version, editors refine it on the canvas.
import {
  type DraftDetail,
  type DraftImagesDto,
  type DraftSummary,
  type JobRef,
  type MagazineDetail,
  type MagazineSummary,
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
import { writeImagePrompt } from './agent/visual';
import { activeStyleRules, tracked, writerPrompt } from './ai';
import type { Services } from './context';
import { canonicalUrl, sha256 } from './scraper/collect';
import { extractArticle } from './scraper/parse';
import { planOnFinalize } from './social-plan';
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

async function categoryIdOf(db: Db, slug: string | null | undefined): Promise<number | null> {
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
export async function createDraftsFromItems(s: Services, staff: Staff, input: z.infer<typeof SaveSelectionInput>) {
  const items = await s.db
    .select({ id: scrapedItems.id, title: scrapedItems.title, categoryId: scrapedItems.categoryId, status: scrapedItems.status })
    .from(scrapedItems)
    .where(inArray(scrapedItems.id, input.itemIds));
  const usable = input.itemIds.map((id) => items.find((i) => i.id === id)).filter((i) => i && i.status !== 'in_draft') as typeof items;
  if (usable.length === 0) throw new AppError(409, 'nothing_to_save', 'הכתבות שנבחרו כבר נמצאות בעריכה.');

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
  for (const [position, item] of usable.entries()) {
    const [draft] = await s.db
      .insert(articleDrafts)
      .values({
        magazineId,
        position,
        origin: 'scraped',
        scrapedItemId: item.id,
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

async function nextPosition(db: Db, magazineId: string | undefined): Promise<number> {
  if (!magazineId) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${articleDrafts.position}), -1)::int + 1` })
    .from(articleDrafts)
    .where(eq(articleDrafts.magazineId, magazineId));
  return row?.n ?? 0;
}

async function assertMagazine(db: Db, magazineId: string | undefined) {
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
  const prompt = await writerPrompt(s.db, 'rewrite.system');
  // Learned house style, then the editor agent's settings (divergence, length, voice; facts always kept).
  const systemPrompt = prompt.body.replace('{{style_rules}}', `${await activeStyleRules(s.db)}\n${await editorGuidelinesFor(s.db)}`);
  const sourceName = item.sourceName ?? new URL(item.url).hostname.replace(/^www\./, '');
  const textAi = await s.ai.text();
  const { result, aiJobId } = await tracked(
    s.db,
    { type: 'rewrite', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey: 'rewrite.system', promptVersion: prompt.version },
    () => textAi.rewrite({ systemPrompt, source: { title: item.title, intro: item.intro, body: item.body ?? item.intro ?? '', sourceName, url: item.url, language: item.language } }),
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
  return { version: updated!.version };
}

export async function markRewriteFailed(s: Services, job: JobRow) {
  await s.db
    .update(articleDrafts)
    .set({ status: 'ai_failed' })
    .where(and(eq(articleDrafts.id, String(job.payload.draftId)), inArray(articleDrafts.status, [...AI_BUSY])));
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
    const [item] = await s.db.select({ title: scrapedItems.title, body: scrapedItems.bodyText }).from(scrapedItems).where(eq(scrapedItems.id, draft.scrapedItemId)).limit(1);
    if (item) original = `${item.title}\n\n${item.body ?? ''}`.slice(0, 20_000);
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
  opts: { useSourceImage?: boolean } = {},
) {
  const draft = await loadDraft(s.db, draftId);
  if (await activeJob(s.db, draftId, ['draft.images'])) throw new AppError(409, 'images_busy', 'התמונות עוד נוצרות. חכו רגע.');
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

export async function runImages(s: Services, job: JobRow) {
  const batchId = String(job.payload.batchId);
  const purpose = job.payload.purpose === 'social' ? 'social' : 'article';
  const [batch] = await s.db.select().from(imageBatches).where(eq(imageBatches.id, batchId)).limit(1);
  if (!batch) throw new PermanentJobError('batch not found');
  const count = purpose === 'social' ? 2 : ARTICLE_DRAFTS;
  const imageAi = await s.ai.image(purpose === 'social' ? 'final' : 'draft');
  // The images follow the article itself, not only the brief; the original's photo is used only when the editor asked.
  const draft = await loadDraft(s.db, batch.draftId);
  const reference = job.payload.useSourceImage ? await sourceImageReference(s, draft) : null;
  let description = batch.prompt;
  if (!description) {
    // The visual agent describes the image (in Hebrew, shown to the editor); earlier descriptions were not what the editor wanted.
    const tried = await s.db
      .select({ prompt: imageBatches.prompt })
      .from(imageBatches)
      .where(and(eq(imageBatches.draftId, batch.draftId), eq(imageBatches.purpose, 'article'), ne(imageBatches.id, batchId), ne(imageBatches.prompt, '')))
      .orderBy(desc(imageBatches.createdAt))
      .limit(5);
    description = await writeImagePrompt(s, draft, { requestedBy: job.createdBy, images: reference ? [reference] : [], tried: tried.map((t) => t.prompt) });
    await s.db.update(imageBatches).set({ prompt: description }).where(eq(imageBatches.id, batchId));
  }
  // A Hebrew description goes to the image model in English (kept on the images as their prompt).
  let brief = description;
  if (/[א-ת]/.test(description)) {
    const textAi = await s.ai.text();
    const { result } = await tracked(s.db, { type: 'translate', provider: textAi.provider, draftId: batch.draftId, requestedBy: job.createdBy }, () => textAi.toEnglish([description]));
    brief = result.data.texts[0] || description;
  }
  const prompt = imageBrief(draft, brief, Boolean(reference));
  const { result, aiJobId } = await tracked(
    s.db,
    { type: purpose === 'social' ? 'social_image' : 'article_images', provider: imageAi.provider, model: imageAi.model, draftId: batch.draftId, requestedBy: job.createdBy, imageCount: count },
    async () => ({ images: await imageAi.generate(prompt, { count, shape: purpose === 'social' ? 'portrait' : 'landscape', references: reference ? [reference] : [] }) }),
  );
  await s.db.update(imageBatches).set({ aiJobId }).where(eq(imageBatches.id, batchId));
  const ids: string[] = [];
  for (const buffer of result.images) {
    const media = await ingestImage(s.db, s.storage, buffer, {
      kind: purpose === 'social' ? 'ai_social' : 'ai_preview',
      isAiGenerated: true,
      aiPrompt: brief,
      batchId,
      createdBy: job.createdBy,
      credit: 'איור: AI',
      focalY: purpose === 'social' ? 0.5 : 0.45,
      renditions: purpose === 'social' ? undefined : [...DRAFT_RENDITIONS],
    });
    ids.push(media.id);
  }
  // The first story image is preselected; the editor can pick the other one, ask again or upload.
  if (purpose === 'social' && ids[0]) {
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
  const draftId = String(job.payload.draftId);
  const previewId = String(job.payload.previewId);
  const [preview] = await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, previewId)).limit(1);
  if (!preview) throw new PermanentJobError('draft image not found');
  // Chosen again after it was made (e.g. on a retry): reuse it rather than pay twice.
  let [final] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.derivedFromId, previewId)).limit(1);
  if (!final) {
    const imageAi = await s.ai.image('final');
    const reference = await draftReference(s, preview.storageKey);
    const { result } = await tracked(
      s.db,
      { type: 'article_images', provider: imageAi.provider, model: imageAi.model, draftId, requestedBy: job.createdBy, imageCount: 1 },
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
      createdBy: job.createdBy,
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
  return { mediaId: final.id };
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
      // A quick draft: its full-quality version if that was made already; otherwise the draft stands in until it is.
      const [final] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.derivedFromId, m.id)).limit(1);
      if (final) heroMediaId = final.id;
      else finishPreview = m.id;
    }
  }
  const set: Partial<typeof articleDrafts.$inferInsert> = { updatedBy: staff.id };
  if (input.category !== undefined) set.categoryId = await categoryIdOf(s.db, input.category);
  if (input.placement !== undefined) set.placement = input.placement;
  if (input.tags !== undefined) set.tagNames = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  if (input.authorId !== undefined) set.authorId = input.authorId;
  if (input.colorLabel !== undefined) set.colorLabel = input.colorLabel;
  if (input.sendPush !== undefined) set.sendPush = input.sendPush;
  if (heroMediaId !== undefined) set.heroMediaId = heroMediaId;
  if (input.disclosure !== undefined) set.disclosure = input.disclosure;
  await s.db.update(articleDrafts).set(set).where(eq(articleDrafts.id, draftId));
  if (finishPreview) await requestFinalImage(s, staff.id, draftId, finishPreview);
}

/** The original's wording to compare with (manual drafts have none). */
async function originalWording(s: Services, draft: DraftRow): Promise<string | null> {
  if (!draft.scrapedItemId) return null;
  const [item] = await s.db.select({ body: scrapedItems.bodyText, intro: scrapedItems.intro, bodyHe: scrapedItems.bodyHe }).from(scrapedItems).where(eq(scrapedItems.id, draft.scrapedItemId)).limit(1);
  // A translated original is compared in Hebrew: copying the translation is copying.
  return item?.bodyHe ?? item?.body ?? item?.intro ?? '';
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
  // The social editor writes the distribution plan from the final text.
  await planOnFinalize(s, staff, draftId);
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

function toSummary(s: Services, r: SummaryRow): DraftSummary {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    origin: r.origin,
    colorLabel: r.colorLabel,
    category: r.category,
    placement: r.placement,
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
  return {
    magazines: mags.map((m) => toMagazineSummary(s, m, drafts.filter((d) => d.magazineId === m.id))),
    singles: singles.map((r) => toSummary(s, r)),
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
  const rows = await summaryQuery(s.db).where(inArray(articleDrafts.id, ids));
  return rows.map((r) => toSummary(s, r));
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
  return { ...toMagazineSummary(s, m, drafts), drafts: drafts.map((d) => toSummary(s, d)) };
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
    return {
      id: b.id,
      prompt: b.prompt,
      promptBy: (b.promptBy as PromptAuthor | null) ?? null,
      createdAt: b.createdAt.toISOString(),
      images: media.filter((m) => m.generationBatchId === b.id).map((m) => toMediaDto(s.storage, m)),
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
  let upgrade: DraftImagesDto['upgrade'] = null;
  if (hero?.kind === 'ai_preview') {
    const [job] = await s.db
      .select({ status: jobs.status, error: jobs.lastError })
      .from(jobs)
      .where(and(eq(jobs.draftId, draftId), eq(jobs.kind, FINAL_IMAGE_JOB), sql`${jobs.payload}->>'previewId' = ${hero.id}`))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    const working = job?.status === 'queued' || job?.status === 'running';
    upgrade = working ? { status: 'working', error: null } : { status: 'failed', error: imageErrorMessage(job?.error ?? null) };
  }
  return { batches, activeJob: drawing, heroId: hero?.id ?? null, chosenId: hero ? (hero.derivedFromId ?? hero.id) : null, upgrade };
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
