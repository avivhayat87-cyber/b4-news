// The social package of an article: story image + headline + two sentences.
// Opens only after the text is final (so AI tokens are spent on the final text).
import type { SocialPackageDto } from '@b4/shared';
import { and, asc, desc, eq, inArray, jobs, mediaAssets, socialAccounts, socialPackages, socialPosts, sql } from '@b4/db';
import { AppError, errors } from '../errors';
import { toMediaDto } from '../lib/images';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { activePrompt, tracked } from './ai';
import type { Services } from './context';
import { imageBatchesOf, loadDraft, requestImages } from './drafts';

type Staff = { id: string };

const OPEN_STATUSES = ['text_final', 'ready', 'published'];

export function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.replace(/[.!?…"״']/g, '').trim().length > 0).length;
}

async function openDraft(s: Services, draftId: string) {
  const draft = await loadDraft(s.db, draftId);
  if (!OPEN_STATUSES.includes(draft.status)) throw new AppError(409, 'text_not_final', 'מודול הרשתות נפתח אחרי שמסמנים את הטקסט כסופי.');
  return draft;
}

/** Creates the package row and one post target per active account (first time only). */
async function ensurePackage(s: Services, draftId: string) {
  await s.db.insert(socialPackages).values({ draftId }).onConflictDoNothing();
  const accounts = await s.db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.isActive, true));
  if (accounts.length) {
    await s.db
      .insert(socialPosts)
      .values(accounts.map((a) => ({ draftId, socialAccountId: a.id })))
      .onConflictDoNothing();
  }
}

export async function getSocial(s: Services, draftId: string): Promise<SocialPackageDto> {
  await openDraft(s, draftId);
  await ensurePackage(s, draftId);
  const [pkg] = await s.db.select().from(socialPackages).where(eq(socialPackages.draftId, draftId)).limit(1);
  const [image] = pkg?.imageMediaId ? await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, pkg.imageMediaId)).limit(1) : [];
  const posts = await s.db
    .select({
      accountId: socialAccounts.id,
      platform: socialAccounts.platform,
      displayName: socialAccounts.displayName,
      linkInFirstComment: socialAccounts.linkInFirstComment,
      enabled: socialPosts.enabled,
      status: socialPosts.status,
      lastError: socialPosts.lastError,
      postedAt: socialPosts.postedAt,
    })
    .from(socialPosts)
    .innerJoin(socialAccounts, eq(socialPosts.socialAccountId, socialAccounts.id))
    .where(eq(socialPosts.draftId, draftId))
    .orderBy(asc(socialAccounts.platform));
  const [job] = await s.db
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, error: jobs.lastError })
    .from(jobs)
    .where(and(eq(jobs.draftId, draftId), inArray(jobs.kind, ['social.generate', 'draft.images']), inArray(jobs.status, ['queued', 'running'])))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return {
    headline: pkg!.headline,
    caption: pkg!.caption,
    image: image ? toMediaDto(s.storage, image) : null,
    isStale: pkg!.isStale,
    approvedAt: pkg!.approvedAt?.toISOString() ?? null,
    version: pkg!.version,
    posts: posts.map((p) => ({ ...p, postedAt: p.postedAt?.toISOString() ?? null })),
    batches: await imageBatchesOf(s, draftId, 'social'),
    activeJob: job ?? null,
  };
}

export async function requestSocial(s: Services, staff: Staff, draftId: string, what: 'text' | 'image' | 'both', instruction?: string) {
  await openDraft(s, draftId);
  await ensurePackage(s, draftId);
  if (what === 'image') return requestImages(s, staff.id, draftId, 'social', instruction);
  return enqueue(s.db, 'social.generate', { draftId, what, instruction: instruction ?? null }, { draftId, createdBy: staff.id, maxAttempts: 2 });
}

export async function runSocialGenerate(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  const what = String(job.payload.what);
  const instruction = job.payload.instruction ? String(job.payload.instruction) : undefined;
  const draft = await loadDraft(s.db, draftId);
  const [pkg] = await s.db.select().from(socialPackages).where(eq(socialPackages.draftId, draftId)).limit(1);
  if (!pkg) throw new PermanentJobError('no social package');
  const prompt = await activePrompt(s.db, 'social.caption');
  const textAi = await s.ai.text();
  const { result } = await tracked(
    s.db,
    { type: 'social_caption', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey: 'social.caption', promptVersion: prompt.version },
    () =>
      textAi.social({
        systemPrompt: prompt.body,
        article: { title: draft.title, subtitle: draft.subtitle, body: draft.bodyText },
        current: pkg.caption ? { headline: pkg.headline, caption: pkg.caption } : undefined,
        instruction,
      }),
  );
  await s.db
    .update(socialPackages)
    .set({
      headline: result.data.headline,
      caption: result.data.caption,
      aiBaselineCaption: pkg.aiBaselineCaption ?? result.data.caption,
      isStale: false,
      approvedAt: null,
      version: sql`${socialPackages.version} + 1`,
    })
    .where(eq(socialPackages.draftId, draftId));
  if (what === 'both') await requestImages(s, job.createdBy, draftId, 'social', result.data.image_prompt);
  return { ok: true };
}

export async function updateSocial(s: Services, staff: Staff, draftId: string, input: { version: number; headline: string; caption: string; imageMediaId?: string | null }) {
  const draft = await openDraft(s, draftId);
  if (input.imageMediaId) {
    if (input.imageMediaId === draft.heroMediaId) throw new AppError(422, 'same_image', 'תמונת הסטורי חייבת להיות שונה מהתמונה הראשית של הכתבה.');
    const [m] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, input.imageMediaId)).limit(1);
    if (!m) throw errors.notFound('התמונה');
  }
  const [row] = await s.db
    .update(socialPackages)
    .set({
      headline: input.headline,
      caption: input.caption,
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      approvedAt: null,
      approvedBy: null,
      version: sql`${socialPackages.version} + 1`,
    })
    .where(and(eq(socialPackages.draftId, draftId), eq(socialPackages.version, input.version)))
    .returning({ version: socialPackages.version });
  if (!row) throw new AppError(409, 'version_conflict', 'החבילה עודכנה בינתיים (אולי על ידי ה-AI). רעננו.');
  return { version: row.version };
}

export async function approveSocial(s: Services, staff: Staff, draftId: string) {
  const draft = await openDraft(s, draftId);
  const [pkg] = await s.db.select().from(socialPackages).where(eq(socialPackages.draftId, draftId)).limit(1);
  if (!pkg) throw errors.notFound('חבילת הרשתות');
  const problems: string[] = [];
  if (!pkg.headline.trim()) problems.push('חסרה כותרת');
  if (!pkg.caption.trim()) problems.push('חסר טקסט');
  else if (sentenceCount(pkg.caption) > 2) problems.push('הטקסט צריך להיות עד שני משפטים');
  if (!pkg.imageMediaId) problems.push('חסרה תמונת סטורי');
  else if (pkg.imageMediaId === draft.heroMediaId) problems.push('תמונת הסטורי זהה לתמונה הראשית');
  if (problems.length) throw new AppError(422, 'social_incomplete', problems.join(' · '));
  await s.db.update(socialPackages).set({ approvedAt: new Date(), approvedBy: staff.id, isStale: false }).where(eq(socialPackages.draftId, draftId));
}

export async function setTargets(s: Services, draftId: string, accounts: { accountId: string; enabled: boolean }[]) {
  await openDraft(s, draftId);
  await ensurePackage(s, draftId);
  for (const a of accounts) {
    await s.db
      .update(socialPosts)
      .set({ enabled: a.enabled })
      .where(and(eq(socialPosts.draftId, draftId), eq(socialPosts.socialAccountId, a.accountId)));
  }
}
