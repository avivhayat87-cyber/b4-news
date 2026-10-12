// The learning loop: every published article's AI draft is compared with the
// editor's final text; from time to time the AI distills those corrections
// into house-style rules, which go into every future rewrite prompt.
import type { LearningOverview } from '@b4/shared';
import { type Db, aiJobs, and, articles, categories, desc, eq, inArray, jobs, sql, styleFeedback, styleProfiles, users } from '@b4/db';
import { alias } from 'drizzle-orm/pg-core';
import { errors } from '../errors';
import { enqueue, type JobRow } from '../lib/jobs';
import { editRatio, unifiedDiff } from '../lib/text-diff';
import { activeStyleRules, tracked } from './ai';
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
  const { result, aiJobId } = await tracked(s.db, { type: 'style_distill', provider: s.ai.text.provider, requestedBy: job.createdBy }, () =>
    s.ai.text.distill({
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
