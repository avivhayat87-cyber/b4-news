// The learning loop: every published article's AI draft is compared with the
// editor's final text. After each publish batch, all of its articles (source
// excerpt, the AI-to-final diff, the image choice) go to the AI in one call,
// which updates the house-style rules used in every future rewrite and writes
// a short report of what it learned. A manual "learn now" distills whatever is pending.
import type { LearningOverview, LearningReportDto } from '@b4/shared';
import {
  type Db,
  aiJobs,
  and,
  articleDrafts,
  articles,
  categories,
  desc,
  eq,
  imageBatches,
  inArray,
  jobs,
  learningReports,
  mediaAssets,
  publishJobs,
  scrapedItems,
  sql,
  styleFeedback,
  styleProfiles,
  users,
} from '@b4/db';
import { alias } from 'drizzle-orm/pg-core';
import { errors } from '../errors';
import { enqueue, type JobRow } from '../lib/jobs';
import { editRatio, unifiedDiff } from '../lib/text-diff';
import { activePrompt, activeStyleRules, tracked } from './ai';
import { editorGuidelinesFor } from './agent/editor';
import type { Services } from './context';
import type { DraftRow } from './drafts';

/** Feedback rows needed before an automatic distillation. */
export const DISTILL_EVERY = 5;
/** Below this the editor changed (almost) nothing; nothing to learn. */
const MIN_RATIO = 0.02;

export async function recordFeedback(db: Db, draft: DraftRow, articleId: number, editorId: string) {
  if (!draft.aiBaselineText) return;
  const aiText = `${draft.aiBaselineTitle ?? ''}\n\n${draft.aiBaselineText}`.trim();
  const finalText = `${draft.title}\n\n${draft.bodyText}`.trim();
  const [job] = draft.aiBaselineJobId ? await db.select({ model: aiJobs.model, promptVersion: aiJobs.promptVersion }).from(aiJobs).where(eq(aiJobs.id, draft.aiBaselineJobId)).limit(1) : [];
  const ratio = editRatio(aiText, finalText);
  await db
    .insert(styleFeedback)
    .values({
      draftId: draft.id,
      articleId,
      categoryId: draft.categoryId,
      editorId,
      aiText,
      finalText,
      unifiedDiff: unifiedDiff(aiText, finalText),
      editRatio: ratio,
      aiModel: job?.model ?? 'unknown',
      promptVersion: job?.promptVersion ?? null,
      status: ratio < MIN_RATIO ? 'excluded' : 'pending',
    })
    .onConflictDoNothing();
}

async function distillJob(db: Db) {
  const [job] = await db
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, error: jobs.lastError })
    .from(jobs)
    .where(and(eq(jobs.kind, 'learning.distill'), inArray(jobs.status, ['queued', 'running'])))
    .limit(1);
  return job ?? null;
}

export async function queueDistill(s: Services, staffId: string | null, force = false) {
  if (await distillJob(s.db)) return null;
  if (!force) {
    const [{ n } = { n: 0 }] = await s.db.select({ n: sql<number>`count(*)::int` }).from(styleFeedback).where(eq(styleFeedback.status, 'pending'));
    if (n < DISTILL_EVERY) return null;
  }
  return enqueue(s.db, 'learning.distill', {}, { createdBy: staffId, maxAttempts: 2 });
}

export async function runDistill(s: Services, job: JobRow) {
  const pending = await s.db
    .select()
    .from(styleFeedback)
    .where(eq(styleFeedback.status, 'pending'))
    .orderBy(desc(styleFeedback.editRatio))
    .limit(20);
  if (pending.length === 0) return { skipped: 'nothing pending' };
  const currentRules = await activeStyleRules(s.db);
  const textAi = await s.ai.text();
  const { result, aiJobId } = await tracked(s.db, { type: 'style_distill', provider: textAi.provider, requestedBy: job.createdBy }, () =>
    textAi.distill({
      currentRules,
      examples: pending.map((f) => ({ aiText: f.aiText, finalText: f.finalText, diff: f.unifiedDiff, editRatio: f.editRatio })),
    }),
  );
  await s.db.transaction(async (tx) => {
    await tx.update(styleProfiles).set({ isActive: false }).where(eq(styleProfiles.isActive, true));
    await tx.insert(styleProfiles).values({ rules: result.data.rules, exampleIds: pending.map((f) => f.id), feedbackCount: pending.length, isActive: true, aiJobId });
    await tx.update(styleFeedback).set({ status: 'distilled' }).where(inArray(styleFeedback.id, pending.map((f) => f.id)));
  });
  return { learnedFrom: pending.length };
}

// ---------------------------------------------------------------------------
// Learning per publish batch: one report, one AI call
// ---------------------------------------------------------------------------
export const BATCH_LEARNING_JOB = 'learning.batch';

/** After a publish job: every article it published is learned from together, in a single call. */
export async function queueBatchLearning(s: Services, publishJobId: string, staffId: string | null) {
  return enqueue(s.db, BATCH_LEARNING_JOB, { publishJobId }, { createdBy: staffId, maxAttempts: 2 });
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export async function runBatchLearning(s: Services, job: JobRow) {
  const publishJobId = String(job.payload.publishJobId);
  const [pj] = await s.db.select().from(publishJobs).where(eq(publishJobs.id, publishJobId)).limit(1);
  if (!pj) return { skipped: 'publish job not found' };
  const [done] = await s.db.select({ id: learningReports.id }).from(learningReports).where(eq(learningReports.publishJobId, publishJobId)).limit(1);
  if (done) return { skipped: 'already learned' };

  const draftIds = pj.magazineId
    ? (await s.db.select({ id: articleDrafts.id }).from(articleDrafts).where(eq(articleDrafts.magazineId, pj.magazineId))).map((d) => d.id)
    : pj.draftId
      ? [pj.draftId]
      : [];
  const rows = draftIds.length
    ? await s.db
        .select({
          feedback: styleFeedback,
          section: categories.name,
          sourceTitle: scrapedItems.title,
          sourceBody: scrapedItems.bodyText,
          sourceBodyHe: scrapedItems.bodyHe,
          sourceIntro: scrapedItems.intro,
          heroKind: mediaAssets.kind,
          heroPrompt: mediaAssets.aiPrompt,
        })
        .from(styleFeedback)
        .innerJoin(articleDrafts, eq(styleFeedback.draftId, articleDrafts.id))
        .leftJoin(categories, eq(styleFeedback.categoryId, categories.id))
        .leftJoin(scrapedItems, eq(articleDrafts.scrapedItemId, scrapedItems.id))
        .leftJoin(mediaAssets, eq(articleDrafts.heroMediaId, mediaAssets.id))
        .where(and(inArray(styleFeedback.draftId, draftIds), eq(styleFeedback.status, 'pending')))
    : [];

  if (rows.length === 0) {
    await s.db.insert(learningReports).values({ publishJobId, articleCount: 0, status: 'skipped', summary: 'בקבוצה הזו לא היו שינויים של עורכים ללמוד מהם.' }).onConflictDoNothing();
    return { learnedFrom: 0 };
  }

  const batches = await s.db
    .select({ draftId: imageBatches.draftId, n: sql<number>`count(*)::int` })
    .from(imageBatches)
    .where(and(inArray(imageBatches.draftId, rows.map((r) => r.feedback.draftId)), eq(imageBatches.purpose, 'article')))
    .groupBy(imageBatches.draftId);
  const imageNote = (r: (typeof rows)[number]) => {
    const tries = batches.find((b) => b.draftId === r.feedback.draftId)?.n ?? 0;
    const chosen = !r.heroKind ? 'no main image' : r.heroKind === 'upload' ? 'the editor uploaded their own image' : r.heroKind === 'scraped_original' ? "the source's image" : `an AI image (prompt: ${clip(r.heroPrompt ?? '', 200)})`;
    return `${chosen}; ${tries} AI image round(s) requested`;
  };

  // Compact on purpose: an excerpt of the source and the diff, not three full copies of every article.
  const articles = rows.map((r) => ({
    section: r.section ?? 'ללא קטגוריה',
    source: clip([r.sourceTitle, r.sourceIntro, r.sourceBodyHe ?? r.sourceBody].filter(Boolean).join('\n'), 1500),
    diff: clip(r.feedback.unifiedDiff, 3000),
    editRatio: r.feedback.editRatio,
    images: imageNote(r),
  }));
  const currentRules = await activeStyleRules(s.db);
  const settings = await editorGuidelinesFor(s.db);
  const prompt = await activePrompt(s.db, 'learning.batch');
  const textAi = await s.ai.text();
  const { result, aiJobId } = await tracked(
    s.db,
    { type: 'style_distill', provider: textAi.provider, requestedBy: job.createdBy, promptKey: 'learning.batch', promptVersion: prompt.version },
    () => textAi.learnBatch({ systemPrompt: prompt.body, currentRules, settings, articles }),
  );
  const ids = rows.map((r) => r.feedback.id);
  await s.db.transaction(async (tx) => {
    await tx.update(styleProfiles).set({ isActive: false }).where(eq(styleProfiles.isActive, true));
    const [profile] = await tx
      .insert(styleProfiles)
      .values({ rules: result.data.rules, exampleIds: ids, feedbackCount: ids.length, isActive: true, aiJobId })
      .returning({ id: styleProfiles.id });
    await tx.update(styleFeedback).set({ status: 'distilled' }).where(inArray(styleFeedback.id, ids));
    await tx.insert(learningReports).values({
      publishJobId,
      articleCount: ids.length,
      status: 'succeeded',
      summary: result.data.summary,
      profileId: profile!.id,
      aiJobId,
      inputTokens: result.usage.inputTokens,
    });
  });
  return { learnedFrom: ids.length };
}

export async function learningReportsList(s: Services): Promise<LearningReportDto[]> {
  const rows = await s.db.select().from(learningReports).orderBy(desc(learningReports.createdAt)).limit(30);
  return rows.map((r) => ({
    id: r.id,
    publishJobId: r.publishJobId,
    articleCount: r.articleCount,
    status: r.status as LearningReportDto['status'],
    summary: r.summary,
    profileId: r.profileId,
    inputTokens: r.inputTokens,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function learningOverview(s: Services): Promise<LearningOverview> {
  const [stats] = await s.db
    .select({
      pending: sql<number>`count(*) filter (where ${styleFeedback.status} = 'pending')::int`,
      distilled: sql<number>`count(*) filter (where ${styleFeedback.status} = 'distilled')::int`,
      avg: sql<number | null>`avg(${styleFeedback.editRatio})::float8`,
    })
    .from(styleFeedback);
  const recent = await s.db
    .select({
      id: styleFeedback.id,
      articleTitle: articles.title,
      category: categories.slug,
      editorName: users.fullName,
      editRatio: styleFeedback.editRatio,
      status: styleFeedback.status,
      createdAt: styleFeedback.createdAt,
    })
    .from(styleFeedback)
    .leftJoin(articles, eq(styleFeedback.articleId, articles.id))
    .leftJoin(categories, eq(styleFeedback.categoryId, categories.id))
    .leftJoin(users, eq(styleFeedback.editorId, users.id))
    .orderBy(desc(styleFeedback.createdAt))
    .limit(30);
  const approver = alias(users, 'approver');
  const profiles = await s.db
    .select({ id: styleProfiles.id, rules: styleProfiles.rules, feedbackCount: styleProfiles.feedbackCount, isActive: styleProfiles.isActive, createdAt: styleProfiles.createdAt, approvedBy: approver.fullName })
    .from(styleProfiles)
    .leftJoin(approver, eq(styleProfiles.approvedBy, approver.id))
    .orderBy(desc(styleProfiles.id))
    .limit(20);
  return {
    pending: stats?.pending ?? 0,
    distilled: stats?.distilled ?? 0,
    averageEditRatio: stats?.avg ?? null,
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    profiles: profiles.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    activeJob: await distillJob(s.db),
  };
}

export async function activateProfile(s: Services, staffId: string, id: number) {
  const [p] = await s.db.select({ id: styleProfiles.id }).from(styleProfiles).where(eq(styleProfiles.id, id)).limit(1);
  if (!p) throw errors.notFound('הגרסה');
  await s.db.transaction(async (tx) => {
    await tx.update(styleProfiles).set({ isActive: false }).where(eq(styleProfiles.isActive, true));
    await tx.update(styleProfiles).set({ isActive: true, approvedBy: staffId }).where(eq(styleProfiles.id, id));
  });
}

/** An editor's own edit of the rules becomes a new active version (history kept). */
export async function saveRules(s: Services, staffId: string, rules: string) {
  await s.db.transaction(async (tx) => {
    await tx.update(styleProfiles).set({ isActive: false }).where(eq(styleProfiles.isActive, true));
    await tx.insert(styleProfiles).values({ rules, feedbackCount: 0, isActive: true, approvedBy: staffId });
  });
}
