// The distribution plan. When an article's text is marked final, the social editor (the AI;
// its settings and what it learns are in agent/social.ts) decides how the article goes out on
// the networks and writes the texts, knowing every option the system has: the catalog below is
// generated from the code and the accounts, so a new frame or account is known at once. The
// newsroom changes the plan quickly in the report on the social page, or in the editor.
// Publishing the article copies the plan to its share (the social page) and sends it out. A
// reel is only recommended by the AI: a person approves the idea here (it costs a video), and
// the video itself on the social page, before it goes out.
import { randomUUID } from 'node:crypto';
import {
  DESIGN_FORMATS,
  type DraftStatus,
  type PlanState,
  REEL_DURATIONS,
  REEL_MOTIONS,
  type ReelIdea,
  SHARE_FORMATS,
  SHARE_SIZES,
  SHARE_TEMPLATES,
  type ShareFormat,
  type ShareTemplate,
  type SocialPlanDto,
  type SocialPlanReport,
  type UpdateSocialPlanInput,
  VIDEO_PRICE_PER_SECOND,
} from '@b4/shared';
import { and, articleDrafts, articleShares, categories, desc, eq, gte, inArray, isNull, jobs, mediaAssets, socialPlans, sql } from '@b4/db';
import { AppError, errors } from '../errors';
import { toMediaDto } from '../lib/images';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { getSocialSettings, socialGuidance } from './agent/social';
import { tracked, writerPrompt } from './ai';
import type { Services } from './context';
import { renderDesign } from './social-design';
import { REEL_MOTION_TEXT, reelSettingsOf, startExpressReel } from './social-reel';
import { kitTexts, listTargets, postsOf, queueAutoPosts, renderShare, siteHost } from './social-share';

type Staff = { id: string };
type PlanRow = typeof socialPlans.$inferSelect;
type PlanSource = { draft: { id: string; title: string; status: DraftStatus; heroMediaId: string | null }; category: string | null; plan: PlanRow | null };

export const PLAN_JOB = 'social.plan';
/** The text is final and the article not published yet: the time for a plan. */
const PLANNABLE: DraftStatus[] = ['text_final', 'ready'];
/** How long a published article stays in the report, with what went out. */
const RECENT_DAYS = 3;

/** What each frame is for, as the social editor is told (typed by the frames, so a new one can't be left out). */
const FRAME_USE: Record<ShareTemplate, string> = {
  headline: 'the full photo with a strong headline on it; the default for most stories',
  breaking: 'a red "breaking" band and the publishing time: news that just happened (a decision, a data release, a sharp market move)',
  quote: 'one strong statement or one number carries the story; the hook becomes the large text',
  explainer: 'a light, orderly frame for service journalism: guides, rights, how-to, "what you need to know"',
};

const size = (f: (typeof DESIGN_FORMATS)[number]) => `${SHARE_SIZES[f].width}x${SHARE_SIZES[f].height}`;
const FORMAT_USE: Record<ShareFormat, string> = {
  feed: `an image post, 4:5 (${size('feed')}), the frame drawn on the article's photo. Free.`,
  story: `a vertical image, 9:16 (${size('story')}), the same frame. Free. Gone after a day: best for news of the moment.`,
  reel: 'a short vertical video (9:16): a new picture in the spirit of the article, animated with a slow camera move, with the branded cover. Costs money (below).',
};

const jerusalemTime = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });

/** Every option the social editor can choose from, from the code and the accounts as they are now. */
export async function optionsCatalog(s: Services): Promise<string> {
  const { model, settings } = await reelSettingsOf(s, {});
  const perSecond = VIDEO_PRICE_PER_SECOND[model]?.[settings.resolution];
  const price = (seconds: number) => (perSecond === undefined ? 'an unknown price' : `about $${(perSecond * seconds).toFixed(2)}`);
  const targets = await listTargets(s);
  const accounts = targets.length
    ? targets.map((t) => `- ${t.platform} "${t.displayName}": ${t.connected && t.autoFormats.length ? `posts ${t.autoFormats.join(', ')} automatically` : 'not connected: its posts are prepared for the editor to post by hand'}`)
    : ['- (no accounts yet: the plan is kept on the social page)'];
  return [
    'Design frames ("template"):',
    ...SHARE_TEMPLATES.map((t) => `- ${t}: ${FRAME_USE[t]}`),
    '',
    'What can go out:',
    ...SHARE_FORMATS.map((f) => `- ${f}: ${FORMAT_USE[f]}`),
    `A reel's video costs ${REEL_DURATIONS.map((d) => `${price(d)} for ${d} seconds`).join(', ')} (video model ${model}, ${settings.resolution}). You only recommend a reel; a person approves it.`,
    '',
    'Reel camera moves ("reel_motion"):',
    ...REEL_MOTIONS.map((m) => `- ${m}: ${REEL_MOTION_TEXT[m]}`),
    `Reel lengths ("reel_seconds"): ${REEL_DURATIONS.join(', ')} seconds.`,
    '',
    'The accounts the plan goes to when the article is published:',
    ...accounts,
  ].join('\n');
}

// --- Reading ---------------------------------------------------------------------------------
async function sourceOf(s: Services, draftId: string): Promise<PlanSource> {
  const [row] = await s.db
    .select({ draft: { id: articleDrafts.id, title: articleDrafts.title, status: articleDrafts.status, heroMediaId: articleDrafts.heroMediaId }, category: categories.name, plan: socialPlans })
    .from(articleDrafts)
    .leftJoin(socialPlans, eq(socialPlans.draftId, articleDrafts.id))
    .leftJoin(categories, eq(articleDrafts.categoryId, categories.id))
    .where(eq(articleDrafts.id, draftId))
    .limit(1);
  if (!row) throw errors.notFound('הכתבה');
  return row;
}

async function writingDrafts(s: Services, draftIds: string[]): Promise<Set<string>> {
  if (!draftIds.length) return new Set();
  const rows = await s.db
    .select({ draftId: jobs.draftId })
    .from(jobs)
    .where(and(eq(jobs.kind, PLAN_JOB), inArray(jobs.draftId, draftIds), inArray(jobs.status, ['queued', 'running'])));
  return new Set(rows.map((r) => r.draftId).filter((x): x is string => Boolean(x)));
}

function stateOf(plan: PlanRow | null, writing: boolean): PlanState {
  if (plan?.appliedAt) return 'published';
  if (writing) return 'writing';
  if (!plan?.headline) return plan?.lastError ? 'failed' : 'none';
  if (!plan.enabled) return 'off';
  return plan.isStale ? 'stale' : 'ready';
}

const isTemplate = (t: string): t is ShareTemplate => (SHARE_TEMPLATES as readonly string[]).includes(t);
const asFormats = (list: string[]) => list.filter((f): f is ShareFormat => (SHARE_FORMATS as readonly string[]).includes(f));

async function planDtos(s: Services, sources: PlanSource[]): Promise<SocialPlanDto[]> {
  const writing = await writingDrafts(s, sources.map((x) => x.draft.id));
  const mediaIds = [...new Set(sources.flatMap((x) => [x.plan?.imageMediaId, x.draft.heroMediaId]).filter((m): m is string => Boolean(m)))];
  const media = mediaIds.length ? await s.db.select().from(mediaAssets).where(inArray(mediaAssets.id, mediaIds)) : [];
  const articleIds = sources.map((x) => x.plan?.articleId).filter((a): a is number => typeof a === 'number');
  const posts = await postsOf(s, articleIds);
  const shares = articleIds.length ? await s.db.select({ articleId: articleShares.articleId, reelPlan: articleShares.reelPlan }).from(articleShares).where(inArray(articleShares.articleId, articleIds)) : [];
  const { model, settings } = await reelSettingsOf(s, {});
  const perSecond = VIDEO_PRICE_PER_SECOND[model]?.[settings.resolution];
  const url = (key: string | undefined) => (key ? s.storage.url(key) : null);

  return sources.map(({ draft, category, plan }) => {
    const image = media.find((m) => m.id === plan?.imageMediaId);
    const hero = media.find((m) => m.id === draft.heroMediaId);
    const articleId = plan?.articleId ?? null;
    return {
      draftId: draft.id,
      title: draft.title,
      category,
      draftStatus: draft.status,
      state: stateOf(plan, writing.has(draft.id)),
      enabled: plan?.enabled ?? true,
      template: plan && isTemplate(plan.template) ? plan.template : 'headline',
      kicker: plan?.kicker ?? '',
      headline: plan?.headline ?? '',
      hook: plan?.hook ?? '',
      caption: plan?.caption ?? '',
      hashtags: plan?.hashtags ?? [],
      formats: asFormats(plan?.formats ?? ['feed', 'story']),
      reel: plan?.reel ?? null,
      reelEstimateUsd: plan?.reel && perSecond !== undefined ? Math.round(perSecond * plan.reel.durationSeconds * 100) / 100 : null,
      reasons: plan?.reasons ?? { template: '', formats: '' },
      aiChoice: plan?.aiChoice && isTemplate(plan.aiChoice.template) ? { template: plan.aiChoice.template, formats: asFormats(plan.aiChoice.formats), reel: plan.aiChoice.reel } : null,
      image: image ? toMediaDto(s.storage, image) : null,
      heroUrl: hero ? s.storage.url(hero.variants.card ?? hero.storageKey) : null,
      rendered: { feed: url(plan?.rendered.feed), story: url(plan?.rendered.story) },
      articleId,
      posts: articleId ? (posts.get(articleId) ?? []) : [],
      reelStage: shares.find((x) => x.articleId === articleId)?.reelPlan?.stage ?? null,
      error: plan?.lastError ?? null,
      version: plan?.version ?? 0,
      updatedAt: plan?.updatedAt.toISOString() ?? null,
    };
  });
}

/** One draft's plan. Previews drawn before the main image was chosen are drawn again on it. */
export async function getPlan(s: Services, draftId: string): Promise<SocialPlanDto> {
  let source = await sourceOf(s, draftId);
  const plan = source.plan;
  if (plan?.headline && !plan.appliedAt && (plan.rendered.photo ?? '') !== (plan.imageMediaId ?? source.draft.heroMediaId ?? '')) {
    await renderPlan(s, draftId);
    source = await sourceOf(s, draftId);
  }
  return (await planDtos(s, [source]))[0]!;
}

/** The report: every article whose text is final and that isn't published yet, and what went out in the last days. */
export async function planReport(s: Services): Promise<SocialPlanReport> {
  const draftCols = { id: articleDrafts.id, title: articleDrafts.title, status: articleDrafts.status, heroMediaId: articleDrafts.heroMediaId };
  const pending = await s.db
    .select({ draft: draftCols, category: categories.name, plan: socialPlans })
    .from(articleDrafts)
    .leftJoin(socialPlans, eq(socialPlans.draftId, articleDrafts.id))
    .leftJoin(categories, eq(articleDrafts.categoryId, categories.id))
    .where(inArray(articleDrafts.status, PLANNABLE))
    .orderBy(desc(articleDrafts.textFinalizedAt))
    .limit(60);
  const recent = await s.db
    .select({ draft: draftCols, category: categories.name, plan: socialPlans })
    .from(socialPlans)
    .innerJoin(articleDrafts, eq(socialPlans.draftId, articleDrafts.id))
    .leftJoin(categories, eq(articleDrafts.categoryId, categories.id))
    .where(gte(socialPlans.appliedAt, new Date(Date.now() - RECENT_DAYS * 24 * 3600_000)))
    .orderBy(desc(socialPlans.appliedAt))
    .limit(30);
  return { pending: await planDtos(s, pending), recent: await planDtos(s, recent), autoPost: (await getSocialSettings(s.db)).autoPost };
}

// --- Writing the plan (background job) ---------------------------------------------------------
/** Queues the social editor for a draft whose text is final; one plan job at a time per draft. */
export async function requestPlan(s: Services, staff: Staff, draftId: string, instruction?: string): Promise<string> {
  const { draft } = await sourceOf(s, draftId);
  if (draft.status === 'published') throw new AppError(409, 'already_published', 'הכתבה כבר פורסמה. ממשיכים בדף "רשתות חברתיות".');
  if (!PLANNABLE.includes(draft.status)) throw new AppError(409, 'text_not_final', 'תוכנית ההפצה נכתבת אחרי שמסמנים את הטקסט כסופי.');
  await s.db.insert(socialPlans).values({ draftId, updatedBy: staff.id }).onConflictDoNothing();
  const [running] = await s.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, PLAN_JOB), eq(jobs.draftId, draftId), inArray(jobs.status, ['queued', 'running'])))
    .limit(1);
  if (running) return running.id;
  await s.db.update(socialPlans).set({ lastError: null }).where(eq(socialPlans.draftId, draftId));
  return enqueue(s.db, PLAN_JOB, { draftId, instruction: instruction ?? null }, { draftId, createdBy: staff.id, maxAttempts: 2 });
}

/** The text was marked final: the social editor writes the plan, unless the newsroom turned that off. */
export async function planOnFinalize(s: Services, staff: Staff, draftId: string): Promise<void> {
  if (!(await getSocialSettings(s.db)).autoPlan) return;
  const [plan] = await s.db.select({ headline: socialPlans.headline, isStale: socialPlans.isStale }).from(socialPlans).where(eq(socialPlans.draftId, draftId)).limit(1);
  // A plan written for this text stays; one written before the text was reopened is written again.
  if (plan?.headline && !plan.isStale) return;
  await requestPlan(s, staff, draftId);
}

export async function runPlan(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  const instruction = job.payload.instruction ? String(job.payload.instruction) : undefined;
  const source = await sourceOf(s, draftId).catch(() => {
    throw new PermanentJobError('draft not found');
  });
  const { draft, plan } = source;
  // Reopened or published while it waited: nothing to write (a new final text asks again).
  if (!PLANNABLE.includes(draft.status) || !plan || plan.appliedAt) return { skipped: true };
  const [full] = await s.db.select({ subtitle: articleDrafts.subtitle, body: articleDrafts.bodyText }).from(articleDrafts).where(eq(articleDrafts.id, draftId)).limit(1);
  const prompt = await writerPrompt(s.db, 'social.plan');
  const options = await optionsCatalog(s);
  const guidance = await socialGuidance(s.db);
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'social_caption', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey: 'social.plan', promptVersion: prompt.version }, () =>
    textAi.socialPlan({
      systemPrompt: prompt.body,
      options,
      guidance,
      article: { title: draft.title, subtitle: full?.subtitle ?? '', body: full?.body ?? '', section: source.category ?? '' },
      instruction,
    }),
  );
  const out = result.data;
  const stills: ShareFormat[] = [...(out.feed ? (['feed'] as const) : []), ...(out.story ? (['story'] as const) : [])];
  const formats = stills.length ? stills : (['feed'] as ShareFormat[]);
  const reel: ReelIdea = {
    recommended: out.reel_recommended,
    reason: out.reel_reason.trim(),
    idea: out.reel_recommended ? out.reel_idea.trim() : '',
    motion: out.reel_motion,
    durationSeconds: out.reel_seconds,
  };
  // A person's choices stay (a reel they approved keeps its idea); the AI rewrites the texts and its reasons.
  const keep = plan.choicesBy === 'editor';
  await s.db
    .update(socialPlans)
    .set({
      ...kitTexts(out),
      reasons: { template: out.template_reason.trim(), formats: out.formats_reason.trim() },
      aiChoice: { template: out.template, formats, reel: out.reel_recommended },
      reel: keep && plan.formats.includes('reel') && plan.reel ? plan.reel : reel,
      ...(keep ? {} : { template: out.template, formats }),
      isStale: false,
      lastError: null,
      version: sql`${socialPlans.version} + 1`,
    })
    .where(eq(socialPlans.draftId, draftId));
  await renderPlan(s, draftId);
  return { ok: true };
}

export async function markPlanFailed(s: Services, job: JobRow, error: Error) {
  // Messages meant for the newsroom are Hebrew (an AI that isn't connected); anything else is told plainly.
  const message = /[א-ת]/.test(error.message) ? error.message.slice(0, 300) : 'ה-AI לא הצליח לכתוב את תוכנית ההפצה. אפשר לנסות שוב.';
  await s.db.update(socialPlans).set({ lastError: message }).where(eq(socialPlans.draftId, String(job.payload.draftId)));
}

/** Draws the plan's still designs on its photo (the article's main image by default); old previews are removed. */
async function renderPlan(s: Services, draftId: string): Promise<void> {
  const [row] = await s.db
    .select({ plan: socialPlans, heroMediaId: articleDrafts.heroMediaId })
    .from(socialPlans)
    .innerJoin(articleDrafts, eq(socialPlans.draftId, articleDrafts.id))
    .where(eq(socialPlans.draftId, draftId))
    .limit(1);
  if (!row?.plan.headline) return;
  const { plan } = row;
  const mediaId = plan.imageMediaId ?? row.heroMediaId;
  const [media] = mediaId ? await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1) : [];
  let photo: { data: Buffer; focalX: number; focalY: number } | null = null;
  if (media) {
    try {
      photo = { data: await s.storage.get(media.storageKey), focalX: media.focalX, focalY: media.focalY };
    } catch (e) {
      s.log.warn({ media: media.id, err: e instanceof Error ? e.message : e }, 'social plan: photo missing, using the brand background');
    }
  }
  const now = new Date();
  const base = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
  const tag = randomUUID().slice(0, 6);
  const rendered: Record<string, string> = { photo: media?.id ?? '' };
  const wanted = DESIGN_FORMATS.filter((f) => plan.formats.includes(f));
  for (const format of wanted) {
    const jpg = await renderDesign({
      template: isTemplate(plan.template) ? plan.template : 'headline',
      format,
      kicker: plan.kicker,
      headline: plan.headline,
      hook: plan.hook,
      photo,
      site: siteHost(s.config.publicSiteUrl),
      time: jerusalemTime.format(now),
    });
    const key = `${base}/plan-${format}-${tag}.jpg`;
    await s.storage.put(key, jpg, 'image/jpeg');
    rendered[format] = key;
  }
  // Only replace the files if nobody changed the plan while we were drawing.
  const [saved] = await s.db
    .update(socialPlans)
    .set({ rendered })
    .where(and(eq(socialPlans.draftId, draftId), eq(socialPlans.version, plan.version)))
    .returning({ draftId: socialPlans.draftId });
  const drawn = wanted.map((f) => rendered[f]!);
  const previous = [plan.rendered.feed, plan.rendered.story].filter((k): k is string => Boolean(k));
  await s.storage.remove(saved ? previous : drawn).catch(() => undefined);
}

// --- Changing the plan -----------------------------------------------------------------------------
const sameSet = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

export async function updatePlan(s: Services, staff: Staff, draftId: string, input: UpdateSocialPlanInput): Promise<SocialPlanDto> {
  const { plan } = await sourceOf(s, draftId);
  if (!plan) throw errors.notFound('תוכנית ההפצה');
  if (plan.appliedAt) throw new AppError(409, 'plan_applied', 'הכתבה כבר פורסמה, והתוכנית עברה לדף "רשתות חברתיות". משנים שם.');
  if (input.imageMediaId) {
    const [m] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, input.imageMediaId)).limit(1);
    if (!m) throw errors.notFound('התמונה');
  }
  const formats = input.formats ? [...new Set(input.formats)] : undefined;
  const choiceChanged = (input.template !== undefined && input.template !== plan.template) || (formats !== undefined && !sameSet(formats, plan.formats));
  // A reel a person asks for without the AI's suggestion still needs a length and a camera move.
  const wantsReel = (formats ?? plan.formats).includes('reel');
  const reelChanged = input.reelIdea !== undefined || input.reelSeconds !== undefined || (wantsReel && !plan.reel);
  const reel: ReelIdea | null = reelChanged
    ? {
        ...(plan.reel ?? { recommended: false, reason: '', idea: '', motion: 'zoom_in', durationSeconds: 8 }),
        ...(input.reelIdea !== undefined ? { idea: input.reelIdea } : {}),
        ...(input.reelSeconds !== undefined ? { durationSeconds: input.reelSeconds } : {}),
      }
    : plan.reel;
  const [row] = await s.db
    .update(socialPlans)
    .set({
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.template !== undefined ? { template: input.template } : {}),
      ...(formats ? { formats } : {}),
      ...(input.kicker !== undefined ? { kicker: input.kicker } : {}),
      ...(input.headline !== undefined ? { headline: input.headline } : {}),
      ...(input.hook !== undefined ? { hook: input.hook } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.hashtags !== undefined ? { hashtags: [...new Set(input.hashtags)] } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(reelChanged ? { reel } : {}),
      ...(choiceChanged ? { choicesBy: 'editor' } : {}),
      updatedBy: staff.id,
      version: sql`${socialPlans.version} + 1`,
    })
    .where(and(eq(socialPlans.draftId, draftId), eq(socialPlans.version, input.version)))
    .returning({ version: socialPlans.version });
  if (!row) throw new AppError(409, 'version_conflict', 'התוכנית עודכנה בינתיים (אולי על ידי ה-AI). רעננו.');
  const redraw = input.template !== undefined || formats !== undefined || input.kicker !== undefined || input.headline !== undefined || input.hook !== undefined || input.imageMediaId !== undefined;
  if (redraw) await renderPlan(s, draftId);
  return getPlan(s, draftId);
}

// --- Publishing ----------------------------------------------------------------------------------
export type AppliedPlan = { handled: boolean; already: boolean; posts: number; reel: boolean };

/**
 * The article was published: its plan becomes its share on the social page and goes out as
 * planned (the still designs now; an approved reel starts its steps, and goes out once its video
 * is approved). handled is false when there is no plan, so the editor's older social package can
 * go out instead. Safe to run twice: the plan is claimed once.
 */
export async function applyPlan(s: Services, draftId: string, articleId: number, staffId: string): Promise<AppliedPlan> {
  const [plan] = await s.db.select().from(socialPlans).where(eq(socialPlans.draftId, draftId)).limit(1);
  if (!plan?.headline.trim()) return { handled: false, already: false, posts: 0, reel: false };
  const [claimed] = await s.db
    .update(socialPlans)
    .set({ articleId, appliedAt: new Date() })
    .where(and(eq(socialPlans.draftId, draftId), isNull(socialPlans.appliedAt)))
    .returning({ draftId: socialPlans.draftId });
  if (!claimed) return { handled: true, already: true, posts: 0, reel: false };

  const reel = plan.formats.includes('reel') && plan.reel ? plan.reel : null;
  // A share the newsroom already made on the social page is kept as it is.
  await s.db
    .insert(articleShares)
    .values({
      articleId,
      template: plan.template,
      kicker: plan.kicker,
      headline: plan.headline,
      hook: plan.hook,
      caption: plan.caption,
      hashtags: plan.hashtags,
      imageMediaId: plan.imageMediaId,
      formats: plan.formats,
      reelSettings: reel ? { durationSeconds: reel.durationSeconds, motion: reel.motion } : {},
      createdBy: staffId,
    })
    .onConflictDoNothing();
  await renderShare(s, articleId);
  if (!plan.enabled || !(await getSocialSettings(s.db)).autoPost) return { handled: true, already: false, posts: 0, reel: false };

  const stills = DESIGN_FORMATS.filter((f) => plan.formats.includes(f));
  const posts = stills.length ? await queueAutoPosts(s, staffId, articleId, stills) : 0;
  if (reel) await startExpressReel(s, { id: staffId }, articleId, reel.idea);
  return { handled: true, already: false, posts, reel: Boolean(reel) };
}
