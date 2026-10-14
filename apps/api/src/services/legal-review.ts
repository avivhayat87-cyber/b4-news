// The legal review. When a draft's text is marked final, the reviewer (the fast model, skill
// "review.system") reads it and lists only the risks a person must decide on: a suspicion against
// a named private person, a minor or a sex-crime victim, a possible gag order, security
// information (censorship), an unverified report about a listed company, an accusation without
// the other side's response. A risk stops publishing until someone decides: publish as is (with a
// reason), publish with extra caution (the main model rewrites only that passage, and the editor
// approves the change into the text), wait for a response (then add it, or note that none came),
// or don't publish. The admins are emailed when an article is stopped. Every decision is recorded.
import { randomUUID } from 'node:crypto';
import { type DecideReviewInput, type DraftReviewDto, type DraftStatus, REVIEW_FLAGS, REVIEW_FLAG_NAME, type ReviewAction, type ReviewFlag, type ReviewIssueDto, type ReviewState } from '@b4/shared';
import { type Db, type ReviewIssueRecord, and, articleDrafts, categories, draftReviews, eq, inArray, jobs, users } from '@b4/db';
import { AppError, errors } from '../errors';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { getReviewerSettings } from './agent/reviewer';
import { activePrompt, tracked } from './ai';
import type { Services } from './context';
import { amendFinalText, skipDraft } from './drafts';

type Staff = { id: string; fullName: string };
type ReviewRow = typeof draftReviews.$inferSelect;

export const REVIEW_JOB = 'review.check';
export const FIX_JOB = 'review.fix';
const FINAL: DraftStatus[] = ['text_final', 'ready'];

const isOpen = (i: ReviewIssueRecord) => !i.decision || i.decision.action === 'awaiting_response';
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

function stateOf(row: ReviewRow): ReviewState {
  if (row.status === 'checking') return 'checking';
  if (row.waivedAt) return 'waived';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'clear') return 'clear';
  return row.issues.some(isOpen) ? 'flagged' : 'resolved';
}

/** What stops each draft from being published, in Hebrew. A draft that was never checked isn't stopped. */
export async function reviewProblems(db: Db, draftIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!draftIds.length) return out;
  for (const row of await db.select().from(draftReviews).where(inArray(draftReviews.draftId, draftIds))) {
    const state = stateOf(row);
    if (state === 'checking') out.set(row.draftId, 'הבדיקה המשפטית עוד רצה');
    else if (state === 'failed') out.set(row.draftId, 'הבדיקה המשפטית לא הושלמה: בדקו שוב, או אשרו פרסום בלי בדיקה');
    else if (state === 'flagged') out.set(row.draftId, `נעצרה בבדיקה המשפטית: ${row.issues.filter(isOpen).length} סוגיות מחכות להחלטה`);
  }
  return out;
}

// --- Checking (background job) -------------------------------------------------------------
/** Checks a draft whose text is final (again, when asked); one check at a time per draft. */
export async function requestReview(s: Services, staff: { id: string }, draftId: string): Promise<string> {
  const [draft] = await s.db.select({ status: articleDrafts.status }).from(articleDrafts).where(eq(articleDrafts.id, draftId)).limit(1);
  if (!draft) throw errors.notFound('הכתבה');
  if (!FINAL.includes(draft.status)) throw new AppError(409, 'text_not_final', 'הבדיקה המשפטית רצה אחרי שמסמנים את הטקסט כסופי.');
  // The issues stay until the new check replaces them: a decision on a passage that is still there carries over.
  await s.db
    .insert(draftReviews)
    .values({ draftId, status: 'checking' })
    .onConflictDoUpdate({ target: draftReviews.draftId, set: { status: 'checking', lastError: null, waivedBy: null, waivedAt: null, waiveReason: null } });
  const [running] = await s.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, REVIEW_JOB), eq(jobs.draftId, draftId), inArray(jobs.status, ['queued', 'running'])))
    .limit(1);
  if (running) return running.id;
  return enqueue(s.db, REVIEW_JOB, { draftId }, { draftId, createdBy: staff.id, maxAttempts: 1 });
}

/** The text was marked final: the reviewer reads it, unless the newsroom turned the review off. */
export async function reviewOnFinalize(s: Services, staff: { id: string }, draftId: string): Promise<void> {
  if ((await getReviewerSettings(s.db)).enabled) await requestReview(s, staff, draftId);
}

export async function runReview(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  const [row] = await s.db
    .select({ draft: articleDrafts, section: categories.name })
    .from(articleDrafts)
    .leftJoin(categories, eq(articleDrafts.categoryId, categories.id))
    .where(eq(articleDrafts.id, draftId))
    .limit(1);
  if (!row) throw new PermanentJobError('draft not found');
  const { draft } = row;
  // Reopened while it waited: the next final text is checked then.
  if (!FINAL.includes(draft.status)) return { skipped: true };
  const [before] = await s.db.select().from(draftReviews).where(eq(draftReviews.draftId, draftId)).limit(1);
  const prompt = await activePrompt(s.db, 'review.system');
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'legal_review', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey: 'review.system', promptVersion: prompt.version }, () =>
    textAi.review({ systemPrompt: prompt.body, article: { title: draft.title, subtitle: draft.subtitle, body: draft.bodyText, section: row.section ?? '' } }),
  );
  const issues: ReviewIssueRecord[] = [];
  for (const i of result.data.issues) {
    if (!i.quote.trim() || issues.some((x) => same(x.quote, i.quote))) continue;
    // The same risk in the same words was already decided on (the text was reopened for something else).
    const earlier = before?.issues.find((x) => x.flag === i.flag && same(x.quote, i.quote) && x.decision);
    issues.push({ id: randomUUID().slice(0, 8), flag: i.flag, where: i.where, quote: i.quote.trim(), subject: i.subject.trim(), why: i.why.trim(), advice: i.advice.trim(), fix: null, decision: earlier?.decision ?? null });
  }
  await s.db
    .update(draftReviews)
    .set({ status: issues.length ? 'flagged' : 'clear', issues, checkedAt: new Date(), lastError: null, version: (before?.version ?? 0) + 1 })
    .where(eq(draftReviews.draftId, draftId));
  if (issues.some(isOpen) && (await getReviewerSettings(s.db)).emailAdmins) await notifyAdmins(s, draftId, draft.title, issues.filter(isOpen));
  return { issues: issues.length };
}

export async function markReviewFailed(s: Services, job: JobRow, error: Error) {
  // A message meant for the newsroom is Hebrew (an AI that isn't connected); anything else is told plainly.
  const message = /[א-ת]/.test(error.message) ? error.message.slice(0, 300) : 'ה-AI לא הצליח לבדוק את הכתבה. אפשר לבדוק שוב.';
  await s.db.update(draftReviews).set({ status: 'failed', lastError: message }).where(eq(draftReviews.draftId, String(job.payload.draftId)));
}

/** One email to every active admin; a failed email never fails the review. */
async function notifyAdmins(s: Services, draftId: string, title: string, issues: ReviewIssueRecord[]) {
  const admins = await s.db.select({ email: users.email }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  const lines = issues.map((i) => `- ${REVIEW_FLAG_NAME[i.flag as ReviewFlag] ?? i.flag}: "${i.quote}"\n  למה: ${i.why}\n  מה כדאי לעשות: ${i.advice}`);
  const text = [
    `הכתבה "${title}" נעצרה לפני פרסום, ומחכה להחלטה שלך.`,
    '',
    'מה נמצא:',
    ...lines,
    '',
    `לפתיחת הכתבה: ${s.config.cmsUrl}/drafts/${draftId}`,
    '',
    'אפשר לאשר את הפרסום, לפרסם בזהירות מוגברת, לחכות לתגובה, או לא לפרסם.',
  ].join('\n');
  let sent = 0;
  for (const a of admins) {
    try {
      await s.mailer.send({ to: a.email, subject: `כתבה נעצרה לבדיקה משפטית: ${title.slice(0, 80)}`, text });
      sent++;
    } catch (e) {
      s.log.warn({ draftId, err: e instanceof Error ? e.message : e }, 'legal review: email to an admin failed');
    }
  }
  if (sent) await s.db.update(draftReviews).set({ notifiedAt: new Date() }).where(eq(draftReviews.draftId, draftId));
}

// --- Reading -----------------------------------------------------------------------------------
function issueDto(i: ReviewIssueRecord): ReviewIssueDto {
  return {
    id: i.id,
    flag: (REVIEW_FLAGS as readonly string[]).includes(i.flag) ? (i.flag as ReviewFlag) : 'private_suspect',
    where: i.where === 'title' || i.where === 'subtitle' ? i.where : 'body',
    quote: i.quote,
    subject: i.subject,
    why: i.why,
    advice: i.advice,
    fix: i.fix,
    decision: i.decision ? { action: i.decision.action as ReviewAction, reason: i.decision.reason, response: i.decision.response, by: i.decision.by, at: i.decision.at } : null,
    open: isOpen(i),
  };
}

async function reviewDtos(s: Services, drafts: { id: string; title: string; status: DraftStatus }[]): Promise<DraftReviewDto[]> {
  if (!drafts.length) return [];
  const rows = await s.db.select().from(draftReviews).where(inArray(draftReviews.draftId, drafts.map((d) => d.id)));
  const waivers = rows.flatMap((r) => (r.waivedBy ? [r.waivedBy] : []));
  const names = waivers.length ? await s.db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, waivers)) : [];
  return drafts.map((d) => {
    const row = rows.find((r) => r.draftId === d.id);
    const issues = (row?.issues ?? []).map(issueDto);
    return {
      draftId: d.id,
      title: d.title,
      draftStatus: d.status,
      state: row ? stateOf(row) : null,
      issues,
      openCount: issues.filter((i) => i.open).length,
      error: row?.lastError ?? null,
      checkedAt: row?.checkedAt?.toISOString() ?? null,
      waived: row?.waivedAt ? { by: names.find((n) => n.id === row.waivedBy)?.name ?? '', at: row.waivedAt.toISOString(), reason: row.waiveReason ?? '' } : null,
    };
  });
}

export async function getReview(s: Services, draftId: string): Promise<DraftReviewDto> {
  const [draft] = await s.db.select({ id: articleDrafts.id, title: articleDrafts.title, status: articleDrafts.status }).from(articleDrafts).where(eq(articleDrafts.id, draftId)).limit(1);
  if (!draft) throw errors.notFound('הכתבה');
  return (await reviewDtos(s, [draft]))[0]!;
}

/** The articles waiting for a person: stopped by the review, or whose check didn't finish. */
export async function reviewQueue(s: Services): Promise<DraftReviewDto[]> {
  const rows = await s.db
    .select({ id: articleDrafts.id, title: articleDrafts.title, status: articleDrafts.status, review: draftReviews })
    .from(draftReviews)
    .innerJoin(articleDrafts, eq(draftReviews.draftId, articleDrafts.id))
    .where(inArray(articleDrafts.status, FINAL));
  const waiting = rows.filter((r) => ['flagged', 'failed'].includes(stateOf(r.review)));
  waiting.sort((a, b) => (b.review.checkedAt?.getTime() ?? 0) - (a.review.checkedAt?.getTime() ?? 0));
  return reviewDtos(s, waiting);
}

export async function waitingCount(s: Services): Promise<number> {
  return (await reviewQueue(s)).length;
}

// --- Deciding ---------------------------------------------------------------------------------
async function finalDraft(s: Services, draftId: string) {
  const [draft] = await s.db.select({ status: articleDrafts.status }).from(articleDrafts).where(eq(articleDrafts.id, draftId)).limit(1);
  if (!draft) throw errors.notFound('הכתבה');
  if (!FINAL.includes(draft.status)) throw new AppError(409, 'text_not_final', 'הטקסט כבר לא סופי. כשתסמנו אותו שוב כסופי, הכתבה תיבדק מחדש.');
}

/** Changes one issue; a concurrent change (another editor, the AI's wording) is read again. */
async function changeIssue(s: Services, draftId: string, issueId: string, change: (i: ReviewIssueRecord) => ReviewIssueRecord) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await s.db.select().from(draftReviews).where(eq(draftReviews.draftId, draftId)).limit(1);
    const issue = row?.issues.find((i) => i.id === issueId);
    if (!row || !issue) throw errors.notFound('הסוגיה');
    const issues = row.issues.map((i) => (i.id === issueId ? change(i) : i));
    const [saved] = await s.db
      .update(draftReviews)
      .set({ issues, version: row.version + 1 })
      .where(and(eq(draftReviews.draftId, draftId), eq(draftReviews.version, row.version)))
      .returning({ version: draftReviews.version });
    if (saved) return;
  }
  throw new AppError(409, 'version_conflict', 'הבדיקה עודכנה בינתיים. רעננו.');
}

const NO_RESPONSE = (subject: string) => `פנינו${subject ? ` ל${subject}` : ''} לקבלת תגובה, וזו לא התקבלה עד מועד הפרסום.`;

export async function decideIssue(s: Services, staff: Staff, draftId: string, issueId: string, input: DecideReviewInput): Promise<DraftReviewDto> {
  await finalDraft(s, draftId);
  const [row] = await s.db.select().from(draftReviews).where(eq(draftReviews.draftId, draftId)).limit(1);
  const issue = row?.issues.find((i) => i.id === issueId);
  if (!row || !issue) throw errors.notFound('הסוגיה');
  if (!isOpen(issue)) throw new AppError(409, 'decided', 'כבר הוחלט על הסוגיה הזו.');
  const reason = input.reason?.trim() ?? '';
  const response = input.response?.trim() ?? '';

  switch (input.action) {
    case 'approve':
      if (reason.length < 3) throw new AppError(422, 'reason_required', 'כתבו בקצרה למה אפשר לפרסם את זה כמו שזה.');
      break;
    case 'caution': {
      if (issue.fix?.status !== 'ready') throw new AppError(409, 'no_fix', 'קודם מבקשים ניסוח זהיר, ורק אז מאשרים אותו.');
      const done = await amendFinalText(s, staff.id, draftId, { where: issue.where as 'title' | 'subtitle' | 'body', before: issue.quote, after: issue.fix.after });
      if (!done) throw new AppError(422, 'passage_gone', 'הקטע כבר לא נמצא בכתבה כמו שהוא. פתחו את הטקסט ותקנו אותו בעורך.');
      break;
    }
    case 'response_added':
      if (response.length < 5) throw new AppError(422, 'response_required', 'כתבו את התגובה כמו שהיא צריכה להופיע בכתבה.');
      await amendFinalText(s, staff.id, draftId, { append: response });
      break;
    case 'no_response':
      await amendFinalText(s, staff.id, draftId, { append: NO_RESPONSE(issue.subject) });
      break;
    case 'reject':
      await skipDraft(s, staff, draftId, reason || 'נעצרה בבדיקה המשפטית');
      break;
    case 'awaiting_response':
      break;
  }
  await changeIssue(s, draftId, issueId, (i) => ({ ...i, decision: { action: input.action, reason, response, by: staff.fullName, byId: staff.id, at: new Date().toISOString() } }));
  return getReview(s, draftId);
}

/** "Publish with extra caution": the AI writes a safer wording of the passage, for the editor to approve. */
export async function requestFix(s: Services, staff: { id: string }, draftId: string, issueId: string): Promise<string> {
  await finalDraft(s, draftId);
  const [row] = await s.db.select().from(draftReviews).where(eq(draftReviews.draftId, draftId)).limit(1);
  const issue = row?.issues.find((i) => i.id === issueId);
  if (!row || !issue) throw errors.notFound('הסוגיה');
  if (!isOpen(issue)) throw new AppError(409, 'decided', 'כבר הוחלט על הסוגיה הזו.');
  if (issue.fix?.status === 'writing') throw new AppError(409, 'fix_busy', 'ה-AI כבר כותב ניסוח זהיר לקטע הזה.');
  await changeIssue(s, draftId, issueId, (i) => ({ ...i, fix: { status: 'writing', after: '', error: null } }));
  return enqueue(s.db, FIX_JOB, { draftId, issueId }, { draftId, createdBy: staff.id, maxAttempts: 1 });
}

export async function runFix(s: Services, job: JobRow) {
  const draftId = String(job.payload.draftId);
  const issueId = String(job.payload.issueId);
  const [draft] = await s.db.select().from(articleDrafts).where(eq(articleDrafts.id, draftId)).limit(1);
  const [row] = await s.db.select().from(draftReviews).where(eq(draftReviews.draftId, draftId)).limit(1);
  const issue = row?.issues.find((i) => i.id === issueId);
  if (!draft || !issue) throw new PermanentJobError('draft or issue not found');
  // The paragraph around the passage, so the new wording fits it.
  const field = issue.where === 'title' ? draft.title : issue.where === 'subtitle' ? draft.subtitle : draft.bodyText;
  const context = field.split(/\n\s*\n/).find((p) => p.includes(issue.quote)) ?? field.slice(0, 2000);
  const prompt = await activePrompt(s.db, 'review.fix');
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'legal_review', provider: textAi.provider, draftId, requestedBy: job.createdBy, promptKey: 'review.fix', promptVersion: prompt.version }, () =>
    textAi.reviewFix({ systemPrompt: prompt.body, issue: { flag: issue.flag, why: issue.why, advice: issue.advice, subject: issue.subject }, quote: issue.quote, context }),
  );
  // The new wording replaces only the passage: words before it in the paragraph must not come twice.
  let after = result.data.after.trim();
  const lead = context.slice(0, Math.max(0, context.indexOf(issue.quote))).trim();
  if (lead && after.startsWith(lead)) after = after.slice(lead.length).trim();
  await changeIssue(s, draftId, issueId, (i) => ({ ...i, fix: { status: 'ready', after, error: null } }));
  return { ok: true };
}

export async function markFixFailed(s: Services, job: JobRow, error: Error) {
  const message = /[א-ת]/.test(error.message) ? error.message.slice(0, 300) : 'ה-AI לא הצליח לנסח את הקטע. אפשר לנסות שוב, או לתקן בעורך.';
  await changeIssue(s, String(job.payload.draftId), String(job.payload.issueId), (i) => ({ ...i, fix: { status: 'failed', after: '', error: message } })).catch(() => undefined);
}

/** The check didn't finish (the AI wasn't available): a person may publish without it, with a reason. */
export async function waiveReview(s: Services, staff: Staff, draftId: string, reason: string): Promise<DraftReviewDto> {
  await finalDraft(s, draftId);
  const [row] = await s.db.select().from(draftReviews).where(eq(draftReviews.draftId, draftId)).limit(1);
  if (!row || stateOf(row) !== 'failed') throw new AppError(409, 'not_failed', 'אפשר לפרסם בלי בדיקה רק כשהבדיקה לא הושלמה.');
  await s.db.update(draftReviews).set({ waivedBy: staff.id, waivedAt: new Date(), waiveReason: reason }).where(eq(draftReviews.draftId, draftId));
  return getReview(s, draftId);
}
