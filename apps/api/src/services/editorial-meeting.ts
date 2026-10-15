// The editorial meeting: what discovery found in the last MEETING_HOURS, grouped into topics for
// free (the more sites cover a topic, the hotter it is), and the original stories one AI call
// proposes from them (the chief editor's "meeting.pitch" skill). Nothing is researched until a
// person approves a pitch; then it becomes an idea research (services/research.ts).
import { MEETING_HOURS, type ApprovePitchInput, type MeetingDto, type PitchDto, type StartMeetingInput } from '@b4/shared';
import { type PitchRecord, and, articles, categories, desc, editorialMeetings, eq, gte, inArray, scrapedItems, sources, sql, users } from '@b4/db';
import { AppError, errors } from '../errors';
import { enqueue, type JobRow } from '../lib/jobs';
import { topicOverlap } from '../lib/similarity';
import { activePrompt, tracked } from './ai';
import { textCostUsd } from './ai/prices';
import type { Services } from './context';
import { assertBudget, researchStates, similarByTopic, startResearch } from './research';

export const MEETING_JOB = 'meeting.run';

type Staff = { id: string; fullName: string };
type MeetingRow = typeof editorialMeetings.$inferSelect;

/** Discovered articles read per meeting (the newest), and topics sent to the AI (the hottest). */
const MAX_ITEMS = 300;
const MAX_TOPICS = 25;
/** Below this there is too little to meet about, and an AI would only invent. */
const MIN_ITEMS = 5;
const LEADS_PER_PITCH = 5;

export type MeetingItem = { id: string; title: string; url: string; source: string; category: string | null; at: Date };
export type Topic = { id: string; items: MeetingItem[]; sites: number; category: string | null };

/**
 * Headlines about the same thing, together: each item joins the first topic whose opening headline
 * shares enough of its subject words, else opens one. Topics covered by more sites come first.
 */
export function groupTopics(items: MeetingItem[]): Topic[] {
  const groups: MeetingItem[][] = [];
  for (const item of [...items].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    const home = groups.find((g) => {
      const { score, shared } = topicOverlap(item.title, g[0]!.title);
      return shared >= 2 && score >= 0.5;
    });
    if (home) home.push(item);
    else groups.push([item]);
  }
  return groups
    .map((g) => ({ items: g, sites: new Set(g.map((i) => i.source)).size, category: mostCommon(g.map((i) => i.category)) }))
    .sort((a, b) => b.sites - a.sites || b.items.length - a.items.length || b.items[0]!.at.getTime() - a.items[0]!.at.getTime())
    .map((t, i) => ({ id: `t${i + 1}`, ...t }));
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const hostName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** What discovery found in the meeting's window: the Hebrew headline of a foreign article. */
async function recentItems(s: Services): Promise<MeetingItem[]> {
  const since = new Date(Date.now() - MEETING_HOURS * 3600_000);
  const at = sql<Date>`coalesce(${scrapedItems.publishedAt}, ${scrapedItems.createdAt})`;
  const rows = await s.db
    .select({ id: scrapedItems.id, title: scrapedItems.title, titleHe: scrapedItems.titleHe, url: scrapedItems.url, source: sources.name, category: categories.slug, at })
    .from(scrapedItems)
    .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
    .leftJoin(categories, eq(scrapedItems.categoryId, categories.id))
    .where(gte(at, since))
    .orderBy(desc(at))
    .limit(MAX_ITEMS);
  return rows.map((r) => ({ id: r.id, title: r.titleHe || r.title, url: r.url, source: r.source ?? hostName(r.url), category: r.category, at: new Date(r.at) }));
}

// ---------------------------------------------------------------------------
// Holding a meeting
// ---------------------------------------------------------------------------

export async function startMeeting(s: Services, staff: Staff, input: StartMeetingInput): Promise<MeetingDto> {
  await assertBudget(s);
  const [running] = await s.db.select({ id: editorialMeetings.id }).from(editorialMeetings).where(inArray(editorialMeetings.status, ['queued', 'thinking'])).limit(1);
  if (running) throw new AppError(409, 'meeting_running', 'ישיבת מערכת כבר מתקיימת. חכו שתסתיים.');
  if ((await recentItems(s)).length < MIN_ITEMS) {
    throw new AppError(409, 'nothing_to_meet', `האיתור לא מצא מספיק כתבות ב-${MEETING_HOURS} השעות האחרונות. הריצו איתור כתבות, או כתבו רעיון בלשונית "רעיון לתחקיר".`);
  }
  const [row] = await s.db.insert(editorialMeetings).values({ focus: input.focus, createdBy: staff.id }).returning({ id: editorialMeetings.id });
  await enqueue(s.db, MEETING_JOB, { meetingId: row!.id }, { createdBy: staff.id, maxAttempts: 1 });
  return meeting(s, row!.id);
}

function israelToday(): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
}

const shortTime = (d: Date) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

export async function runMeeting(s: Services, job: JobRow) {
  const row = await loadMeeting(s, String(job.payload.meetingId));
  if (row.status === 'ready') return { skipped: 'ready' };
  await s.db.update(editorialMeetings).set({ status: 'thinking', updatedAt: new Date() }).where(eq(editorialMeetings.id, row.id));

  // 1. Free: our own discovery, grouped into topics, and what we published lately.
  const items = await recentItems(s);
  const topics = groupTopics(items);
  const sent = topics.slice(0, MAX_TOPICS);
  const published = await s.db
    .select({ title: articles.title })
    .from(articles)
    .where(and(eq(articles.status, 'published'), gte(articles.publishedAt, new Date(Date.now() - 3 * 24 * 3600_000))))
    .orderBy(desc(articles.publishedAt))
    .limit(60);

  // 2. One call: the pitches.
  const textAi = await s.ai.text();
  const prompt = await activePrompt(s.db, 'meeting.pitch');
  const { result } = await tracked(
    s.db,
    { type: 'meeting', provider: textAi.provider, requestedBy: job.createdBy, promptKey: 'meeting.pitch', promptVersion: prompt.version, costOf: (r) => (textAi.live ? textCostUsd(r.usage.model, r.usage.inputTokens, r.usage.outputTokens) : null) },
    () =>
      textAi.meeting({
        systemPrompt: prompt.body,
        focus: row.focus,
        topics: sent.map((t) => ({ id: t.id, sites: t.sites, category: t.category, headlines: t.items.slice(0, 6).map((i) => ({ title: i.title, source: i.source, at: shortTime(i.at) })) })),
        published: published.map((p) => p.title),
        today: israelToday(),
      }),
  );
  const cost = textAi.live ? (textCostUsd(result.usage.model, result.usage.inputTokens, result.usage.outputTokens) ?? 0) : 0;

  // A pitch must grow from topics we gave it: one that names none is dropped (it would be invented).
  const byId = new Map(sent.map((t) => [t.id, t]));
  const pitches: PitchRecord[] = [];
  for (const p of result.data.pitches) {
    const from = p.cluster_ids.map((id) => byId.get(id)).filter((t): t is Topic => t !== undefined);
    if (!from.length) continue;
    // One lead per headline and site (a site often lists the same article under two addresses).
    const leads = [...new Map(from.flatMap((t) => t.items).map((i) => [`${i.source}|${i.title}`, i])).values()].slice(0, LEADS_PER_PITCH);
    pitches.push({
      id: `p${pitches.length + 1}`,
      title: p.title,
      angle: p.angle,
      whyNow: p.why_now,
      checks: p.checks,
      officialSources: p.official_sources,
      category: p.category,
      depth: p.depth,
      coverage: new Set(from.flatMap((t) => t.items.map((i) => i.source))).size,
      leads: leads.map((i) => ({ itemId: i.id, title: i.title, url: i.url, source: i.source })),
      similar: await similarByTopic(s, `${p.title} ${p.angle}`),
      status: 'pending',
      researchId: null,
      decidedBy: null,
      decidedAt: null,
    });
  }
  await s.db
    .update(editorialMeetings)
    .set({ status: 'ready', summary: result.data.summary, itemsRead: items.length, topics: topics.length, pitches, costUsd: cost.toFixed(4), lastError: null, updatedAt: new Date() })
    .where(eq(editorialMeetings.id, row.id));
  return { pitches: pitches.length };
}

export async function markMeetingFailed(s: Services, job: JobRow, error: Error) {
  await s.db
    .update(editorialMeetings)
    .set({ status: 'failed', lastError: error.message.slice(0, 2000), updatedAt: new Date() })
    .where(eq(editorialMeetings.id, String(job.payload.meetingId)));
}

// ---------------------------------------------------------------------------
// Deciding on a pitch
// ---------------------------------------------------------------------------

/** The pitch as the reporter reads it: the question, the angle, what to check, and the leads (never sources). */
function ideaText(p: PitchRecord): string {
  return [
    p.title,
    `הזווית: ${p.angle}`,
    p.whyNow ? `למה עכשיו: ${p.whyNow}` : '',
    p.checks.length ? `מה לבדוק:\n${p.checks.map((c) => `- ${c}`).join('\n')}` : '',
    p.officialSources.length ? `מקורות רשמיים לבדוק: ${p.officialSources.join(', ')}` : '',
    p.leads.length ? `כתבות שמצאנו באיתור (רמזים בלבד, לא מקור):\n${p.leads.map((l) => `- ${l.title} (${l.source}): ${l.url}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3000);
}

/**
 * The pitch becomes an idea research (as edited, at the chosen depth). It is claimed inside a
 * transaction first, so two clicks never start two paid research; a research that can't start
 * (the budget) gives it back.
 */
export async function approvePitch(s: Services, staff: Staff, meetingId: string, pitchId: string, input: ApprovePitchInput): Promise<MeetingDto> {
  const claimed = await s.db.transaction(async (tx) => {
    const [row] = await tx.select().from(editorialMeetings).where(eq(editorialMeetings.id, meetingId)).for('update');
    if (!row) throw errors.notFound('הישיבה');
    const pitch = row.pitches.find((p) => p.id === pitchId);
    if (!pitch) throw errors.notFound('ההצעה');
    if (pitch.status !== 'pending') throw new AppError(409, 'pitch_decided', 'כבר הוחלט על ההצעה הזאת.');
    const edited: PitchRecord = { ...pitch, title: input.title ?? pitch.title, angle: input.angle ?? pitch.angle, depth: input.depth ?? pitch.depth, status: 'approved', decidedBy: staff.fullName, decidedAt: new Date().toISOString() };
    await tx.update(editorialMeetings).set({ pitches: row.pitches.map((p) => (p.id === pitchId ? edited : p)), updatedAt: new Date() }).where(eq(editorialMeetings.id, meetingId));
    return edited;
  });
  let researchId: string;
  try {
    const task = await startResearch(s, staff, {
      kind: 'idea',
      note: ideaText(claimed),
      mediaIds: [],
      depth: claimed.depth as PitchDto['depth'],
      ...(input.magazineId ? { magazineId: input.magazineId } : { colorLabel: input.colorLabel ?? 'purple' }),
    });
    researchId = task.id;
  } catch (e) {
    await setPitch(s, meetingId, pitchId, { status: 'pending', decidedBy: null, decidedAt: null });
    throw e;
  }
  await setPitch(s, meetingId, pitchId, { researchId });
  return meeting(s, meetingId);
}

export async function rejectPitch(s: Services, staff: Staff, meetingId: string, pitchId: string): Promise<MeetingDto> {
  const row = await loadMeeting(s, meetingId);
  const pitch = row.pitches.find((p) => p.id === pitchId);
  if (!pitch) throw errors.notFound('ההצעה');
  if (pitch.status === 'approved') throw new AppError(409, 'pitch_decided', 'ההצעה כבר אושרה ונחקרת.');
  await setPitch(s, meetingId, pitchId, { status: 'rejected', decidedBy: staff.fullName, decidedAt: new Date().toISOString() });
  return meeting(s, meetingId);
}

async function setPitch(s: Services, meetingId: string, pitchId: string, patch: Partial<PitchRecord>) {
  await s.db.transaction(async (tx) => {
    const [row] = await tx.select({ pitches: editorialMeetings.pitches }).from(editorialMeetings).where(eq(editorialMeetings.id, meetingId)).for('update');
    if (!row) return;
    await tx
      .update(editorialMeetings)
      .set({ pitches: row.pitches.map((p) => (p.id === pitchId ? { ...p, ...patch } : p)), updatedAt: new Date() })
      .where(eq(editorialMeetings.id, meetingId));
  });
}

// ---------------------------------------------------------------------------
// Reading models
// ---------------------------------------------------------------------------

async function loadMeeting(s: Services, id: string): Promise<MeetingRow> {
  const [row] = await s.db.select().from(editorialMeetings).where(eq(editorialMeetings.id, id)).limit(1);
  if (!row) throw errors.notFound('הישיבה');
  return row;
}

function errorMessage(raw: string | null): string | null {
  if (!raw) return null;
  if (/[א-ת]/.test(raw)) return raw;
  if (/not connected|api key|401|403/i.test(raw)) return 'אין חיבור ל-Claude. בדקו את המפתח ב"הגדרות" > "חיבורים".';
  return 'הישיבה לא הצליחה. אפשר לכנס אותה שוב.';
}

async function meetingDtos(s: Services, rows: (MeetingRow & { createdByName: string | null })[]): Promise<MeetingDto[]> {
  const states = await researchStates(s, rows.flatMap((r) => r.pitches.map((p) => p.researchId).filter((x): x is string => Boolean(x))));
  return rows.map((r) => ({
    id: r.id,
    focus: r.focus,
    status: r.status as MeetingDto['status'],
    summary: r.summary,
    itemsRead: r.itemsRead,
    topics: r.topics,
    pitches: r.pitches.map(({ researchId, decidedAt: _d, ...p }) => ({ ...p, depth: p.depth as PitchDto['depth'], research: researchId ? (states.get(researchId) ?? null) : null })),
    costUsd: Number(r.costUsd),
    error: r.status === 'failed' ? errorMessage(r.lastError) : null,
    createdBy: r.createdByName ?? '',
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function meeting(s: Services, id: string): Promise<MeetingDto> {
  const rows = await s.db.select({ m: editorialMeetings, createdByName: users.fullName }).from(editorialMeetings).leftJoin(users, eq(editorialMeetings.createdBy, users.id)).where(eq(editorialMeetings.id, id)).limit(1);
  if (!rows[0]) throw errors.notFound('הישיבה');
  return (await meetingDtos(s, [{ ...rows[0].m, createdByName: rows[0].createdByName }]))[0]!;
}

/** The latest meetings, newest first. */
export async function meetings(s: Services, limit = 5): Promise<MeetingDto[]> {
  const rows = await s.db.select({ m: editorialMeetings, createdByName: users.fullName }).from(editorialMeetings).leftJoin(users, eq(editorialMeetings.createdBy, users.id)).orderBy(desc(editorialMeetings.createdAt)).limit(limit);
  return meetingDtos(s, rows.map((r) => ({ ...r.m, createdByName: r.createdByName })));
}
