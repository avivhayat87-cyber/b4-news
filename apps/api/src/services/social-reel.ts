// Reels for the social page, made in steps that each wait for the editor:
//   1. prompts: the visual agent (Google) reads the article and looks at its pictures, and writes
//      two prompts in Hebrew (the picture, the video). The editor edits and approves them.
//   2. image: a new Gemini picture from the approved prompt (translated to English for the model),
//      in the spirit of the article's pictures, never a copy; the branded cover is drawn on it.
//   3. video: Google Veo animates the clean picture (no text in it to warp) by the approved video
//      prompt. The editor approves the video, or changes the prompt and asks again.
// Each step is its own job; a picture or a video is made only on the editor's click. A reel that
// a person approved in a distribution plan runs "express": prompts, picture and video follow one
// another by themselves, and stop at the video for the editor's approval; once approved, it goes
// out as the plan said. Every AI call is tracked in ai_jobs. Approving a reel teaches the visual
// agent. Instagram's API can't add music from its library: that is done in the app.
import { randomUUID } from 'node:crypto';
import { type ReelMotion, type ReelPlan, ReelSettings, type ShareTemplate, VIDEO_PRICE_PER_SECOND } from '@b4/shared';
import { and, articleDrafts, articleShares, desc, eq, inArray, jobs, mediaAssets, socialPlans, sql } from '@b4/db';
import sharp from 'sharp';
import { AppError, errors } from '../errors';
import { ingestImage } from '../lib/images';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { getSocialSettings } from './agent/social';
import { recordReelFeedback, writeReelPrompts } from './agent/visual';
import { activePrompt, tracked } from './ai';
import type { ImageReference } from './ai/types';
import { articleBodyText } from './article-content';
import type { Services } from './context';
import { imageErrorMessage, sourceImageReference } from './image-brief';
import { renderDesign } from './social-design';
import { loadArticle, loadShare, queueAutoPosts, siteHost } from './social-share';

type Staff = { id: string };

export const REEL_JOBS = { prompts: 'social.reel_prompts', image: 'social.reel_image', video: 'social.reel_video' } as const;
export const REEL_JOB_KINDS: string[] = Object.values(REEL_JOBS);

/** How the camera moves, as the video model (and the social editor) is told. */
export const REEL_MOTION_TEXT: Record<ReelMotion, string> = {
  zoom_in: 'The camera slowly and smoothly pushes in, about 6% over the whole clip.',
  zoom_out: 'The camera slowly and smoothly pulls back, about 6% over the whole clip.',
  pan: 'The camera drifts slowly and evenly to one side, a gentle lateral move.',
  parallax: 'A gentle parallax: the foreground moves very slightly against the background.',
};

const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '');

export async function reelSettingsOf(s: Services, raw: unknown): Promise<{ settings: ReelSettings; model: string; estimateUsd: number | null }> {
  const settings = ReelSettings.parse(raw ?? {});
  const model = settings.model || (await s.settings.integration('gemini')).videoModel || 'veo-3.1-fast-generate-preview';
  const price = VIDEO_PRICE_PER_SECOND[model]?.[settings.resolution];
  return { settings, model, estimateUsd: price === undefined ? null : Math.round(price * settings.durationSeconds * 100) / 100 };
}

const ofArticle = (articleId: number) => sql`(${jobs.payload}->>'articleId')::bigint = ${articleId}`;

/** Why the article's last reel step failed, in Hebrew (null when it didn't). */
export async function reelError(s: Services, articleId: number): Promise<string | null> {
  const [job] = await s.db
    .select({ status: jobs.status, error: jobs.lastError })
    .from(jobs)
    .where(and(inArray(jobs.kind, REEL_JOB_KINDS), ofArticle(articleId)))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return job?.status === 'failed' ? reelErrorMessage(job.error) : null;
}

export function reelErrorMessage(raw: string | null): string {
  if (!raw) return 'שלב הריל נכשל.';
  if (/^video/.test(raw)) {
    const status = /\((\d{3})\)/.exec(raw)?.[1];
    if (status === '429' && /limit: 0|free tier/i.test(raw)) return 'חשבון Google בתוכנית החינמית, ובה אין יצירת סרטונים. מפעילים חיוב (Billing) בפרויקט ב-aistudio.google.com ואז מנסים שוב.';
    if (status === '404') return 'מודל הווידאו לא נמצא. בדקו את שם המודל ב"הגדרות" > "חיבורים" > Gemini.';
    if (/took too long/.test(raw)) return 'Google לא סיים את הסרטון בזמן. נסו שוב.';
    if (/no video/.test(raw)) return 'Google לא החזיר סרטון (כנראה בגלל סינון תוכן). נסו הנחיה אחרת או תמונה אחרת.';
    return `יצירת הסרטון נכשלה: ${raw.replace(/^video generation failed:?\s*/, '').slice(0, 200)}`;
  }
  return imageErrorMessage(raw);
}

/** A picture as a modest JPEG for the models (they accept it everywhere, and it keeps the request small). */
async function asReference(data: Buffer): Promise<ImageReference> {
  const jpeg = await sharp(data).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  return { data: jpeg, mimeType: 'image/jpeg' };
}

/** What the AI looks at: the article's main image and the original report's photo (when there is one). */
async function articlePictures(s: Services, article: { id: number; title: string; subtitle: string; heroMediaId: string | null; draftId: string | null }): Promise<ImageReference[]> {
  const out: ImageReference[] = [];
  const [hero] = article.heroMediaId ? await s.db.select({ key: mediaAssets.storageKey }).from(mediaAssets).where(eq(mediaAssets.id, article.heroMediaId)).limit(1) : [];
  if (hero) {
    const data = await s.storage.get(hero.key).catch(() => null);
    if (data) out.push(await asReference(data));
  }
  const [draft] = article.draftId ? await s.db.select({ scrapedItemId: articleDrafts.scrapedItemId }).from(articleDrafts).where(eq(articleDrafts.id, article.draftId)).limit(1) : [];
  if (draft?.scrapedItemId) {
    const original = await sourceImageReference(s, { id: article.draftId!, title: article.title, subtitle: article.subtitle, bodyText: '', scrapedItemId: draft.scrapedItemId });
    if (original) out.push(original);
  }
  return out;
}

async function startStep(s: Services, staff: Staff, articleId: number, kind: string, payload: Record<string, unknown> = {}): Promise<string> {
  const [running] = await s.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.kind, REEL_JOB_KINDS), ofArticle(articleId), inArray(jobs.status, ['queued', 'running'])))
    .limit(1);
  if (running) throw new AppError(409, 'reel_busy', 'שלב קודם של הריל עוד רץ. חכו שיסתיים.');
  // A picture or a video costs money: never retried automatically.
  return enqueue(s.db, kind, { articleId, ...payload }, { createdBy: staff.id, maxAttempts: 1 });
}

/** In an express reel, each step queues the next (the step itself is still running, so not through startStep). */
async function nextExpressStep(s: Services, job: JobRow, kind: string) {
  if (!job.payload.express) return;
  await enqueue(s.db, kind, { articleId: Number(job.payload.articleId), express: true }, { createdBy: job.createdBy, maxAttempts: 1 });
}

/**
 * A reel a person approved in the distribution plan: the prompts (from the plan's idea), the
 * picture and the video follow one another by themselves; the video waits for the editor.
 */
export async function startExpressReel(s: Services, staff: Staff, articleId: number, idea: string): Promise<string> {
  await shareWithText(s, articleId);
  return startStep(s, staff, articleId, REEL_JOBS.prompts, { instruction: idea.trim() || null, express: true });
}

async function shareWithText(s: Services, articleId: number) {
  await loadArticle(s, articleId);
  const share = await loadShare(s, articleId);
  if (!share?.headline) throw new AppError(422, 'no_kit', 'קודם מכינים לכתבה טקסט (כותרת ומשפט פתיחה), ואז את הריל.');
  return share;
}

async function setPlan(s: Services, articleId: number, plan: ReelPlan) {
  await s.db.update(articleShares).set({ reelPlan: plan }).where(eq(articleShares.articleId, articleId));
}

// --- 1. Prompts ------------------------------------------------------------------------------
export async function requestReelPrompts(s: Services, staff: Staff, articleId: number, instruction?: string): Promise<string> {
  await shareWithText(s, articleId);
  return startStep(s, staff, articleId, REEL_JOBS.prompts, { instruction: instruction ?? null });
}

export async function runReelPrompts(s: Services, job: JobRow) {
  const articleId = Number(job.payload.articleId);
  const { article, category } = await loadArticle(s, articleId).catch(() => {
    throw new PermanentJobError('article not found or not published');
  });
  const share = await loadShare(s, articleId);
  if (!share?.headline) throw new PermanentJobError('no kit');
  const plan = share.reelPlan;
  const instruction = job.payload.instruction ? String(job.payload.instruction) : undefined;
  // The visual agent (Google) writes them, by the newsroom's settings and what it learned.
  const written = await writeReelPrompts(s, {
    requestedBy: job.createdBy,
    article: { title: article.title, subtitle: article.subtitle || article.excerpt, body: articleBodyText(article), section: category, hook: share.hook },
    images: await articlePictures(s, article),
    current: plan ? { imagePrompt: plan.imagePrompt, videoPrompt: plan.videoPrompt } : undefined,
    instruction,
  });
  // New prompts don't touch what was already made; the editor decides what to make again.
  await setPlan(s, articleId, {
    ...plan,
    stage: plan?.stage ?? 'prompts',
    ...written,
    approvedAt: plan?.approvedAt ?? null,
    suggested: written,
    directions: instruction ? [...(plan?.directions ?? []), instruction].slice(-10) : (plan?.directions ?? []),
  });
  await nextExpressStep(s, job, REEL_JOBS.image);
  return { ok: true };
}

/** The editor's own wording of the prompts. What was already made stays until it is made again. */
export async function updateReelPrompts(s: Services, articleId: number, input: { imagePrompt: string; videoPrompt: string }): Promise<void> {
  const share = await shareWithText(s, articleId);
  if (!share.reelPlan) throw new AppError(409, 'no_plan', 'קודם מכינים את ההנחיות לריל.');
  await setPlan(s, articleId, { ...share.reelPlan, imagePrompt: input.imagePrompt, videoPrompt: input.videoPrompt });
}

// --- 2. The picture ------------------------------------------------------------------------------
export async function requestReelImage(s: Services, staff: Staff, articleId: number): Promise<string> {
  const share = await shareWithText(s, articleId);
  if (!share.reelPlan) throw new AppError(409, 'no_plan', 'קודם מכינים את ההנחיות לריל ומאשרים אותן.');
  return startStep(s, staff, articleId, REEL_JOBS.image);
}

export async function runReelImage(s: Services, job: JobRow) {
  const articleId = Number(job.payload.articleId);
  const { article } = await loadArticle(s, articleId).catch(() => {
    throw new PermanentJobError('article not found or not published');
  });
  const share = await loadShare(s, articleId);
  if (!share?.headline || !share.reelPlan) throw new PermanentJobError('no kit or no plan');
  const plan = share.reelPlan;

  const textAi = await s.ai.text();
  const { result: english } = await tracked(s.db, { type: 'translate', provider: textAi.provider, requestedBy: job.createdBy }, () => textAi.toEnglish([plan.imagePrompt]));
  const template = await activePrompt(s.db, 'reel.image');
  const promptText = fill(template.body, { prompt: english.data.texts[0] ?? plan.imagePrompt });
  const imageAi = await s.ai.image('final');
  const references = await articlePictures(s, article);
  const { result: images } = await tracked(
    s.db,
    { type: 'social_image', provider: imageAi.provider, requestedBy: job.createdBy, promptKey: 'reel.image', promptVersion: template.version, imageCount: 1, model: imageAi.model },
    async () => ({ images: await imageAi.generate(promptText, { count: 1, shape: 'portrait', references }) }),
  );
  const picture = await ingestImage(s.db, s.storage, images.images[0]!, { kind: 'ai_social', isAiGenerated: true, aiPrompt: plan.imagePrompt, createdBy: job.createdBy });

  // The branded cover: the story frame of the chosen template, with the headline, on the new picture.
  const master = await s.storage.get(picture.storageKey);
  const poster = await renderDesign({
    template: share.template as ShareTemplate,
    format: 'story',
    kicker: share.kicker,
    headline: share.headline,
    hook: share.hook,
    photo: { data: master, focalX: picture.focalX, focalY: picture.focalY },
    site: siteHost(s.config.publicSiteUrl),
  });
  const posterKey = `${keyBase()}/reel-poster-${randomUUID().slice(0, 6)}.jpg`;
  await s.storage.put(posterKey, poster, 'image/jpeg');

  // A new picture: the old cover and the old video (made from the old picture) go.
  const old = [share.rendered.reel, share.rendered.reelPoster].filter((k): k is string => Boolean(k));
  const { reel: _video, reelPoster: _poster, ...rest } = share.rendered;
  await s.db
    .update(articleShares)
    .set({ reelImageMediaId: picture.id, rendered: { ...rest, reelPoster: posterKey }, reelPlan: { ...plan, stage: 'image', approvedAt: null, pictures: (plan.pictures ?? 0) + 1 } })
    .where(eq(articleShares.articleId, articleId));
  await s.storage.remove(old).catch(() => undefined);
  await nextExpressStep(s, job, REEL_JOBS.video);
  return { picture: picture.id };
}

function keyBase(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
}

// --- 3. The video ---------------------------------------------------------------------------------
/** The editor approved the picture: the video is made from it. */
export async function requestReelVideo(s: Services, staff: Staff, articleId: number): Promise<string> {
  const share = await shareWithText(s, articleId);
  if (!share.reelPlan || !share.reelImageMediaId || share.reelPlan.stage === 'prompts') throw new AppError(409, 'no_picture', 'קודם יוצרים את התמונה לריל ומאשרים אותה.');
  return startStep(s, staff, articleId, REEL_JOBS.video);
}

export async function runReelVideo(s: Services, job: JobRow) {
  const articleId = Number(job.payload.articleId);
  await loadArticle(s, articleId).catch(() => {
    throw new PermanentJobError('article not found or not published');
  });
  const share = await loadShare(s, articleId);
  if (!share?.reelPlan || !share.reelImageMediaId) throw new PermanentJobError('no picture');
  const plan = share.reelPlan;
  const [picture] = await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, share.reelImageMediaId)).limit(1);
  if (!picture) throw new PermanentJobError('the reel picture is gone');
  const { settings, model, estimateUsd } = await reelSettingsOf(s, share.reelSettings);

  const textAi = await s.ai.text();
  const { result: english } = await tracked(s.db, { type: 'translate', provider: textAi.provider, requestedBy: job.createdBy }, () => textAi.toEnglish([plan.videoPrompt]));
  const template = await activePrompt(s.db, 'reel.video');
  const firstFrame = await sharp(await s.storage.get(picture.storageKey)).jpeg({ quality: 92 }).toBuffer();
  const videoAi = await s.ai.video(model);
  const { result: made } = await tracked(
    s.db,
    {
      type: 'social_video',
      provider: videoAi.provider,
      requestedBy: job.createdBy,
      promptKey: 'reel.video',
      promptVersion: template.version,
      model: videoAi.model,
      // Google bills a video by its seconds; the stand-in costs nothing.
      ...(videoAi.live && estimateUsd !== null ? { costUsd: estimateUsd } : {}),
    },
    () =>
      videoAi.generate({
        prompt: fill(template.body, {
          prompt: english.data.texts[0] ?? plan.videoPrompt,
          motion: REEL_MOTION_TEXT[settings.motion],
          instruction: settings.instruction ? `Editor's direction: ${settings.instruction}` : '',
        }),
        firstFrame: { data: firstFrame, mimeType: 'image/jpeg' },
        durationSeconds: settings.durationSeconds,
        resolution: settings.resolution,
        aspectRatio: '9:16',
      }),
  );
  // Without a video model (development stand-in) nothing is made, and the step stays at the picture.
  if (!made.data.video) return { video: false };

  const videoKey = `${keyBase()}/reel-${randomUUID().slice(0, 6)}.mp4`;
  await s.storage.put(videoKey, made.data.video, 'video/mp4');
  const old = share.rendered.reel;
  await s.db
    .update(articleShares)
    .set({ rendered: { ...share.rendered, reel: videoKey }, reelPlan: { ...plan, stage: 'video', approvedAt: null, videos: (plan.videos ?? 0) + 1 } })
    .where(eq(articleShares.articleId, articleId));
  if (old) await s.storage.remove([old]).catch(() => undefined);
  return { video: true, model: videoAi.model, seconds: settings.durationSeconds };
}

/**
 * The editor approved the video: the reel can be published, and the visual agent learns from how
 * it came about. A reel from a distribution plan goes out now, as the plan said.
 */
export async function approveReel(s: Services, staff: Staff, articleId: number): Promise<void> {
  const share = await loadShare(s, articleId);
  if (!share) throw errors.notFound('הריל');
  if (!share.reelPlan || share.reelPlan.stage !== 'video' || !share.rendered.reel) throw new AppError(409, 'no_video', 'אין עדיין סרטון לאשר.');
  const plan: ReelPlan = { ...share.reelPlan, stage: 'approved', approvedAt: new Date().toISOString() };
  await setPlan(s, articleId, plan);
  const { article, category } = await loadArticle(s, articleId);
  await recordReelFeedback(s, staff.id, { articleId, title: article.title, section: category, plan, pictureId: share.reelImageMediaId });
  const [planned] = await s.db.select({ enabled: socialPlans.enabled, formats: socialPlans.formats }).from(socialPlans).where(eq(socialPlans.articleId, articleId)).limit(1);
  if (planned?.enabled && planned.formats.includes('reel') && (await getSocialSettings(s.db)).autoPost) await queueAutoPosts(s, staff.id, articleId, ['reel']);
}
