// The visual agent (Google Gemini). It writes, in Hebrew, the description of each article's
// main image and the two prompts of a reel, by the newsroom's settings and the rules it has
// learned. It learns from what the editors did with its suggestions: what they rewrote, which
// drawn image they chose and which they passed over (it looks at them), and which reels they
// approved after how many tries. Every few cases (or on "learn now") one Gemini call updates
// its rules, versioned like the house style: an editor can edit them or restore an older one.
import {
  type PromptAuthor,
  type ReelPlan,
  type VisualAgentOverview,
  type VisualAgentSettings,
  VisualAgentSettings as Schema,
  type VisualFeedbackDetail,
} from '@b4/shared';
import { type Db, and, appSettings, asc, categories, desc, eq, imageBatches, inArray, jobs, mediaAssets, sql, users, visualFeedback, visualProfiles } from '@b4/db';
import { alias } from 'drizzle-orm/pg-core';
import sharp from 'sharp';
import { AppError, errors } from '../../errors';
import { enqueue, type JobRow } from '../../lib/jobs';
import { activePrompt, tracked } from '../ai';
import type { ArticleText, ImageReference, VisualLearnRequest } from '../ai/types';
import type { Services } from '../context';
import { imageErrorMessage } from '../image-brief';

const KEY = 'agent.visual';
export const VISUAL_LEARN_JOB = 'visual.learn';
/** Cases needed before the agent learns by itself. */
export const LEARN_EVERY = 5;
/** The most recent cases read in one learning pass; older ones wait for the next. */
const MAX_CASES = 12;
/** Per case, the chosen picture and at most this many that were passed over. */
const MAX_PASSED_OVER = 2;

// --- Settings -------------------------------------------------------------------------------------
export async function getVisualSettings(db: Db): Promise<VisualAgentSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const parsed = Schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : Schema.parse({});
}

export async function saveVisualSettings(db: Db, staffId: string, input: VisualAgentSettings): Promise<VisualAgentSettings> {
  const value = Schema.parse(input);
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}

function settingsText(st: VisualAgentSettings, purpose?: 'image' | 'reel'): string {
  const lines = [
    purpose !== 'reel' && st.articleStyle ? `- Article images: ${st.articleStyle}` : '',
    purpose !== 'image' && st.reelStyle ? `- Reels: ${st.reelStyle}` : '',
    st.instructions ? `- Standing instructions:\n${st.instructions}` : '',
    st.avoid ? `- Never: ${st.avoid}` : '',
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : '(none)';
}

export async function activeVisualRules(db: Db): Promise<string | null> {
  const [row] = await db.select({ rules: visualProfiles.rules }).from(visualProfiles).where(eq(visualProfiles.isActive, true)).orderBy(desc(visualProfiles.id)).limit(1);
  return row?.rules ?? null;
}

/** What the agent gets with every prompt: the newsroom's settings and the rules it learned. */
async function guidanceFor(db: Db, purpose: 'image' | 'reel'): Promise<string> {
  const [st, rules] = await Promise.all([getVisualSettings(db), activeVisualRules(db)]);
  return [
    'Newsroom settings (set by the editors; they come first):',
    settingsText(st, purpose),
    '',
    'Your rules, learned from what the editors did with your earlier suggestions:',
    rules ?? '(nothing learned yet)',
  ].join('\n');
}

async function sectionName(db: Db, categoryId: number | null): Promise<string> {
  if (!categoryId) return 'ללא קטגוריה';
  const [c] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  return c?.name ?? 'ללא קטגוריה';
}

// --- Writing prompts --------------------------------------------------------------------------------
type DraftForImage = { id: string; title: string; subtitle: string; bodyText: string; categoryId: number | null };

/** The description of an article's main image, in Hebrew (the editor sees it; the image model gets it in English). */
export async function writeImagePrompt(s: Services, draft: DraftForImage, opts: { requestedBy: string | null; images: ImageReference[]; tried: string[] }): Promise<string> {
  const [template, guidance, section, visual] = await Promise.all([activePrompt(s.db, 'visual.image'), guidanceFor(s.db, 'image'), sectionName(s.db, draft.categoryId), s.ai.visual()]);
  const { result } = await tracked(
    s.db,
    { type: 'visual_prompt', provider: visual.provider, model: visual.model, draftId: draft.id, requestedBy: opts.requestedBy, promptKey: 'visual.image', promptVersion: template.version },
    () =>
      visual.imagePrompt({
        systemPrompt: template.body,
        guidance,
        article: { title: draft.title, subtitle: draft.subtitle, body: draft.bodyText, section },
        images: opts.images,
        tried: opts.tried,
      }),
  );
  return result.data.prompt.trim().slice(0, 1000);
}

/** A reel's picture and video prompts, in Hebrew, from the article and its pictures. */
export async function writeReelPrompts(
  s: Services,
  opts: { requestedBy: string | null; article: ArticleText & { section: string; hook: string }; images: ImageReference[]; current?: { imagePrompt: string; videoPrompt: string }; instruction?: string },
): Promise<{ imagePrompt: string; videoPrompt: string }> {
  const [template, guidance, visual] = await Promise.all([activePrompt(s.db, 'reel.prompts'), guidanceFor(s.db, 'reel'), s.ai.visual()]);
  const { result } = await tracked(
    s.db,
    { type: 'visual_prompt', provider: visual.provider, model: visual.model, requestedBy: opts.requestedBy, promptKey: 'reel.prompts', promptVersion: template.version },
    () => visual.reelPrompts({ systemPrompt: template.body, guidance, article: opts.article, images: opts.images, current: opts.current, instruction: opts.instruction }),
  );
  return { imagePrompt: result.data.image_prompt.trim().slice(0, 1500), videoPrompt: result.data.video_prompt.trim().slice(0, 1500) };
}

// --- What the editors did -----------------------------------------------------------------------------
/** At publish: how the main image came about. Only when the AI drew options for the article. */
export async function recordImageFeedback(db: Db, draft: DraftForImage & { heroMediaId: string | null }, articleId: number, editorId: string) {
  const batches = await db
    .select()
    .from(imageBatches)
    .where(and(eq(imageBatches.draftId, draft.id), eq(imageBatches.purpose, 'article')))
    .orderBy(asc(imageBatches.createdAt));
  if (!batches.length) return;
  const ids = batches.map((b) => b.id);
  const [options, batchJobs, [hero]] = await Promise.all([
    db
      .select({ id: mediaAssets.id, batchId: mediaAssets.generationBatchId })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.generationBatchId, ids), sql`${mediaAssets.derivedFromId} is null`))
      .orderBy(asc(mediaAssets.createdAt)),
    db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.draftId, draft.id), eq(jobs.kind, 'draft.images'))),
    draft.heroMediaId
      ? db.select({ id: mediaAssets.id, kind: mediaAssets.kind, derivedFromId: mediaAssets.derivedFromId }).from(mediaAssets).where(eq(mediaAssets.id, draft.heroMediaId)).limit(1)
      : Promise.resolve([]),
  ]);
  // The option the editor picked: the main image, or the quick draft it was redrawn from.
  const pickedId = hero ? (hero.derivedFromId ?? hero.id) : null;
  const picked = options.find((o) => o.id === pickedId) ?? null;
  const outcome: Extract<VisualFeedbackDetail, { kind: 'article_image' }>['outcome'] = !hero
    ? 'none'
    : picked
      ? 'ai'
      : hero.kind === 'scraped_original'
        ? 'source'
        : 'upload';
  // Passed over: the rest of the chosen round, or of the last round when no drawn image was used.
  const round = picked?.batchId ?? ids.at(-1);
  const passedOver = options.filter((o) => o.batchId === round && o.id !== pickedId).slice(0, MAX_PASSED_OVER).map((o) => o.id);
  const usedSource = (batchId: string) => batchJobs.some((j) => j.payload.batchId === batchId && j.payload.useSourceImage === true);

  const detail: VisualFeedbackDetail = {
    kind: 'article_image',
    title: draft.title,
    section: await sectionName(db, draft.categoryId),
    rounds: batches.map((b) => ({ by: (b.promptBy as PromptAuthor | null) ?? null, prompt: b.prompt.slice(0, 600), useSource: usedSource(b.id), chosen: b.id === picked?.batchId })),
    outcome,
  };
  await db
    .insert(visualFeedback)
    .values({
      subjectKey: `image:${draft.id}`,
      kind: 'article_image',
      draftId: draft.id,
      articleId,
      detail,
      // The source's own photo is not sent to the agent.
      chosenMediaId: outcome === 'source' ? null : (pickedId ?? null),
      rejectedMediaIds: passedOver,
      createdBy: editorId,
    })
    .onConflictDoNothing();
}

/** When the editor approves a reel: the agent's suggestion against what was approved, and the tries it took. */
export async function recordReelFeedback(s: Services, staffId: string, reel: { articleId: number; title: string; section: string; plan: ReelPlan; pictureId: string | null }) {
  const { plan } = reel;
  await s.db
    .insert(visualFeedback)
    .values({
      subjectKey: `reel:${reel.articleId}:${plan.approvedAt}`,
      kind: 'reel',
      articleId: reel.articleId,
      detail: {
        kind: 'reel',
        title: reel.title,
        section: reel.section,
        suggested: plan.suggested ?? null,
        approved: { imagePrompt: plan.imagePrompt, videoPrompt: plan.videoPrompt },
        directions: plan.directions ?? [],
        pictures: plan.pictures ?? 0,
        videos: plan.videos ?? 0,
      },
      chosenMediaId: reel.pictureId,
      createdBy: staffId,
    })
    .onConflictDoNothing();
  await queueVisualLearning(s, staffId).catch(() => undefined);
}

// --- Learning -------------------------------------------------------------------------------------------
async function learningJob(db: Db) {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, VISUAL_LEARN_JOB), inArray(jobs.status, ['queued', 'running'])))
    .limit(1);
  return job ?? null;
}

async function pendingCount(db: Db): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(visualFeedback).where(eq(visualFeedback.status, 'pending'));
  return n;
}

/** Learns when enough new cases came in (and the newsroom left auto-learning on), or now when forced. */
export async function queueVisualLearning(s: Services, staffId: string | null, force = false) {
  if (await learningJob(s.db)) return null;
  const pending = await pendingCount(s.db);
  if (force) {
    if (pending === 0) throw new AppError(409, 'nothing_to_learn', 'אין עדיין מקרים חדשים ללמוד מהם.');
  } else if (pending < LEARN_EVERY || !(await getVisualSettings(s.db)).autoLearn) {
    return null;
  }
  return enqueue(s.db, VISUAL_LEARN_JOB, {}, { createdBy: staffId, maxAttempts: 2 });
}

const quote = (text: string) => `"${text.replace(/\s+/g, ' ').trim()}"`;

/** One case as the learning pass reads it. */
function caseText(d: VisualFeedbackDetail): string {
  if (d.kind === 'article_image') {
    const outcome = { ai: 'the main image is one of the drawn options', upload: 'the editor uploaded their own image instead', source: "the editor used the source's photo instead", none: 'published without a main image' }[d.outcome];
    return [
      `Article image. Section: ${d.section}. Title: ${d.title}`,
      ...d.rounds.map(
        (r, i) =>
          `Round ${i + 1}, description by ${r.by === 'agent' ? 'you' : r.by === 'editor' ? 'the editor' : 'the writer AI (English)'}${r.useSource ? ', inspired by the source photo' : ''}: ${quote(r.prompt)}${r.chosen ? ' → the editor chose an image from this round' : ''}`,
      ),
      `Outcome: ${outcome}.`,
    ].join('\n');
  }
  return [
    `Reel. Section: ${d.section}. Title: ${d.title}`,
    d.suggested ? `Your last suggestion. Picture: ${quote(d.suggested.imagePrompt)} Video: ${quote(d.suggested.videoPrompt)}` : 'You made no suggestion (the editor wrote the prompts).',
    `Approved by the editor. Picture: ${quote(d.approved.imagePrompt)} Video: ${quote(d.approved.videoPrompt)}`,
    d.directions.length ? `Directions the editor gave you: ${d.directions.map(quote).join('; ')}` : '',
    `Pictures made until approval: ${d.pictures}; videos: ${d.videos}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** A small JPEG of a stored image, for the agent to look at (null if it is gone). */
async function thumbnail(s: Services, mediaId: string): Promise<ImageReference | null> {
  const [m] = await s.db.select({ key: mediaAssets.storageKey }).from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1);
  if (!m) return null;
  try {
    const data = await sharp(await s.storage.get(m.key)).rotate().resize({ width: 512, height: 512, fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    return { data, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

async function casePictures(s: Services, f: typeof visualFeedback.$inferSelect) {
  const chosenLabel = f.detail.kind === 'reel' ? 'the reel picture the editor approved' : f.detail.outcome === 'ai' ? 'the image the editor chose' : 'the image the editor uploaded instead';
  const wanted = [...(f.chosenMediaId ? [{ id: f.chosenMediaId, label: chosenLabel }] : []), ...f.rejectedMediaIds.map((id) => ({ id, label: 'an option the editor passed over' }))];
  const out: { label: string; image: ImageReference }[] = [];
  for (const w of wanted) {
    const image = await thumbnail(s, w.id);
    if (image) out.push({ label: w.label, image });
  }
  return out;
}

export async function runVisualLearning(s: Services, job: JobRow) {
  const pending = await s.db.select().from(visualFeedback).where(eq(visualFeedback.status, 'pending')).orderBy(desc(visualFeedback.createdAt)).limit(MAX_CASES);
  if (pending.length === 0) return { skipped: 'nothing pending' };
  const [template, st, currentRules, visual] = await Promise.all([activePrompt(s.db, 'visual.learn'), getVisualSettings(s.db), activeVisualRules(s.db), s.ai.visual()]);
  const cases: VisualLearnRequest['cases'] = [];
  for (const f of pending) cases.push({ text: caseText(f.detail), images: await casePictures(s, f) });
  const { result, aiJobId } = await tracked(
    s.db,
    { type: 'visual_learning', provider: visual.provider, model: visual.model, requestedBy: job.createdBy, promptKey: 'visual.learn', promptVersion: template.version },
    () => visual.learn({ systemPrompt: template.body, currentRules: currentRules ?? '', settings: settingsText(st), cases }),
  );
  const ids = pending.map((f) => f.id);
  await s.db.transaction(async (tx) => {
    await tx.update(visualProfiles).set({ isActive: false }).where(eq(visualProfiles.isActive, true));
    await tx.insert(visualProfiles).values({ rules: result.data.rules, summary: result.data.summary || null, feedbackCount: ids.length, isActive: true, aiJobId });
    await tx.update(visualFeedback).set({ status: 'distilled' }).where(inArray(visualFeedback.id, ids));
  });
  return { learnedFrom: ids.length };
}

// --- The CMS tab ------------------------------------------------------------------------------------
export async function visualOverview(s: Services): Promise<VisualAgentOverview> {
  const visual = await s.ai.visual().catch(() => null);
  const [[stats], recent, profiles, active, [last]] = await Promise.all([
    s.db
      .select({
        pending: sql<number>`count(*) filter (where ${visualFeedback.status} = 'pending')::int`,
        learned: sql<number>`count(*) filter (where ${visualFeedback.status} = 'distilled')::int`,
      })
      .from(visualFeedback),
    s.db
      .select({ id: visualFeedback.id, kind: visualFeedback.kind, detail: visualFeedback.detail, status: visualFeedback.status, createdAt: visualFeedback.createdAt })
      .from(visualFeedback)
      .orderBy(desc(visualFeedback.createdAt))
      .limit(20),
    (() => {
      const approver = alias(users, 'approver');
      return s.db
        .select({
          id: visualProfiles.id,
          rules: visualProfiles.rules,
          summary: visualProfiles.summary,
          feedbackCount: visualProfiles.feedbackCount,
          isActive: visualProfiles.isActive,
          approvedBy: approver.fullName,
          createdAt: visualProfiles.createdAt,
        })
        .from(visualProfiles)
        .leftJoin(approver, eq(visualProfiles.approvedBy, approver.id))
        .orderBy(desc(visualProfiles.id))
        .limit(20);
    })(),
    learningJob(s.db),
    s.db.select({ status: jobs.status, error: jobs.lastError }).from(jobs).where(eq(jobs.kind, VISUAL_LEARN_JOB)).orderBy(desc(jobs.createdAt)).limit(1),
  ]);
  return {
    live: visual?.live ?? false,
    model: visual?.model ?? '—',
    pending: stats?.pending ?? 0,
    learned: stats?.learned ?? 0,
    learnEvery: LEARN_EVERY,
    recent: recent.map((r) => ({ id: r.id, kind: r.kind as 'article_image' | 'reel', title: r.detail.title, status: r.status, createdAt: r.createdAt.toISOString() })),
    profiles: profiles.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    learning: Boolean(active),
    lastError: last?.status === 'failed' ? imageErrorMessage(last.error) : null,
  };
}

export async function activateVisualProfile(s: Services, staffId: string, id: number) {
  const [p] = await s.db.select({ id: visualProfiles.id }).from(visualProfiles).where(eq(visualProfiles.id, id)).limit(1);
  if (!p) throw errors.notFound('הגרסה');
  await s.db.transaction(async (tx) => {
    await tx.update(visualProfiles).set({ isActive: false }).where(eq(visualProfiles.isActive, true));
    await tx.update(visualProfiles).set({ isActive: true, approvedBy: staffId }).where(eq(visualProfiles.id, id));
  });
}

/** An editor's own wording of the rules becomes the active version (the history is kept). */
export async function saveVisualRules(s: Services, staffId: string, rules: string) {
  await s.db.transaction(async (tx) => {
    await tx.update(visualProfiles).set({ isActive: false }).where(eq(visualProfiles.isActive, true));
    await tx.insert(visualProfiles).values({ rules, isActive: true, approvedBy: staffId });
  });
}
