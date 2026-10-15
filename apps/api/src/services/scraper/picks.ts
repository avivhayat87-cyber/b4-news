// The chief editor's picks after every discovery run, Israeli and international: one call on the
// fast model reads the run's stories (grouped for free, desk.ts) and recommends the ones to take
// first, each with a score and a reason (the "discovery.pick" skill). The code keeps the owner's
// rules whatever the model answered: at least one story from every section that has articles,
// only a few from the leisure sections, and only stories the run really has.
import { CATEGORIES, DiscoveryPickSettings, type DiscoveryPickSettings as Settings } from '@b4/shared';
import { type Db, type RunPicksRecord, and, appSettings, articles, desc, eq, gte, scrapeRuns } from '@b4/db';
import { AppError, errors } from '../../errors';
import { enqueue, type JobRow } from '../../lib/jobs';
import { activePrompt, tracked } from '../ai';
import { textCostUsd } from '../ai/prices';
import type { Services } from '../context';
import { type DeskItem, runItems } from './desk';

export const PICK_JOB = 'discovery.pick';
const SETTINGS_KEY = 'agent.picks';
/** Stories sent to the model (the most covered first) and headlines per story: enough to judge, cheap to read. */
const MAX_STORIES = 200;
const HEADLINES_PER_STORY = 3;
/** The leisure sections together get at most this share of the picks (but always one each). */
const LEISURE_SHARE = 0.2;

export async function getPickSettings(db: Db): Promise<Settings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const parsed = DiscoveryPickSettings.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : DiscoveryPickSettings.parse({});
}

export async function savePickSettings(db: Db, staffId: string, input: Settings): Promise<Settings> {
  const value = DiscoveryPickSettings.parse(input);
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}

/**
 * The picks are on their way (the CMS shows "choosing…"). After a run: only when the picks are on;
 * an editor's request (force): always, unless they are already being chosen.
 */
export async function queuePicks(s: Services, runId: string, staffId: string | null, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && !(await getPickSettings(s.db)).on) return false;
  const [run] = await s.db.select({ picks: scrapeRuns.picks, status: scrapeRuns.status }).from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1);
  if (!run) throw errors.notFound('האיתור');
  if (run.status === 'queued' || run.status === 'running') throw new AppError(409, 'run_running', 'האיתור עוד רץ. ההמלצות יגיעו כשיסתיים.');
  if (run.picks?.status === 'pending') return false;
  await s.db.update(scrapeRuns).set({ picks: { status: 'pending', items: [], error: null, at: null } }).where(eq(scrapeRuns.id, runId));
  await enqueue(s.db, PICK_JOB, { runId }, { createdBy: staffId, maxAttempts: 2 });
  return true;
}

export type Story = { leadId: string; category: string | null; sites: number; at: number; items: DeskItem[] };

/** A run's stories still to take (articles already in editing are not recommended), the most covered first. */
export function storiesOf(items: DeskItem[]): Story[] {
  const map = new Map<string, DeskItem[]>();
  for (const i of items) {
    if (i.status !== 'new') continue;
    const key = i.storyId ?? i.id;
    map.set(key, [...(map.get(key) ?? []), i]);
  }
  return [...map.values()]
    .map((g) => ({
      leadId: g[0]!.id,
      category: g[0]!.category,
      sites: new Set(g.map((i) => i.source.name)).size,
      at: Math.max(...g.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : 0))),
      items: g,
    }))
    .sort((a, b) => b.sites - a.sites || b.at - a.at);
}

type Chosen = RunPicksRecord['items'][number] & { category: string | null };

/**
 * The owner's rules over the model's answer: real stories only, each once, scores 1-100; a story
 * from every section that has one; the leisure sections kept small; then no more than the count
 * (a section's only story stays even beyond it).
 */
export function settlePicks(proposed: { leadId: string; score: number; reason: string }[], stories: Story[], settings: Pick<Settings, 'count' | 'leisure'>): RunPicksRecord['items'] {
  const byLead = new Map(stories.map((t) => [t.leadId, t]));
  const picks: Chosen[] = [];
  for (const p of proposed) {
    const story = byLead.get(p.leadId);
    if (!story || picks.some((x) => x.itemId === p.leadId)) continue;
    picks.push({ itemId: p.leadId, score: Math.min(100, Math.max(1, Math.round(p.score))), reason: p.reason.trim(), category: story.category });
  }
  picks.sort((a, b) => b.score - a.score);
  picks.splice(settings.count);

  // Every section that has stories gets its most covered one.
  const lowest = picks.at(-1)?.score ?? 50;
  for (const t of stories) {
    if (!t.category || picks.some((p) => p.category === t.category)) continue;
    picks.push({ itemId: t.leadId, score: Math.max(1, Math.min(lowest, 40)), reason: 'הסיפור הבולט במדור', category: t.category });
  }

  const inSection = (category: string | null) => picks.filter((p) => p.category === category).length;
  const dropLowest = (where: (p: Chosen) => boolean) => {
    const candidates = picks.filter((p) => where(p) && (p.category === null || inSection(p.category) > 1));
    const victim = candidates.sort((a, b) => a.score - b.score)[0];
    if (victim) picks.splice(picks.indexOf(victim), 1);
    return Boolean(victim);
  };
  const leisure = (p: Chosen) => p.category !== null && settings.leisure.includes(p.category as Settings['leisure'][number]);
  const leisureSections = new Set(picks.filter(leisure).map((p) => p.category)).size;
  const leisureMax = Math.max(leisureSections, Math.round(settings.count * LEISURE_SHARE));
  while (picks.filter(leisure).length > leisureMax && dropLowest(leisure));
  while (picks.length > settings.count && dropLowest(() => true));

  return picks.sort((a, b) => b.score - a.score).map(({ category: _, ...p }) => p);
}

const SECTION_NAME = new Map<string, string>(CATEGORIES.map((c) => [c.slug, c.name]));
/** What discovery couldn't place in an economic section (the CMS's "פוליטיקה ושונות"). */
const NO_SECTION = 'בלי מדור כלכלי (פוליטיקה ושונות)';

const israelToday = () =>
  new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());

export async function runPicks(s: Services, job: JobRow) {
  const runId = String(job.payload.runId);
  const settings = await getPickSettings(s.db);
  const stories = storiesOf(await runItems(s.db, runId));
  const done = async (items: RunPicksRecord['items']) => {
    await s.db.update(scrapeRuns).set({ picks: { status: 'ready', items, error: null, at: new Date().toISOString() } }).where(eq(scrapeRuns.id, runId));
    return { picks: items.length };
  };
  if (stories.length === 0) return done([]);

  const sent = stories.slice(0, MAX_STORIES).map((t, i) => ({ key: `s${i + 1}`, story: t }));
  const published = await s.db
    .select({ title: articles.title })
    .from(articles)
    .where(and(eq(articles.status, 'published'), gte(articles.publishedAt, new Date(Date.now() - 2 * 24 * 3600_000))))
    .orderBy(desc(articles.publishedAt))
    .limit(60);

  const textAi = await s.ai.text();
  const prompt = await activePrompt(s.db, 'discovery.pick');
  const { result } = await tracked(
    s.db,
    { type: 'discovery_pick', provider: textAi.provider, requestedBy: job.createdBy, promptKey: 'discovery.pick', promptVersion: prompt.version, costOf: (r) => (textAi.live ? textCostUsd(r.usage.model, r.usage.inputTokens, r.usage.outputTokens) : null) },
    () =>
      textAi.discoveryPick({
        systemPrompt: prompt.body,
        count: settings.count,
        leisure: settings.leisure.map((slug) => SECTION_NAME.get(slug) ?? slug),
        stories: sent.map(({ key, story }) => ({
          id: key,
          sites: story.sites,
          section: story.category ? (SECTION_NAME.get(story.category) ?? story.category) : NO_SECTION,
          headlines: story.items.slice(0, HEADLINES_PER_STORY).map((i) => ({ title: i.titleHe ?? i.title, source: i.source.name })),
        })),
        published: published.map((p) => p.title),
        today: israelToday(),
      }),
  );
  const byKey = new Map(sent.map(({ key, story }) => [key, story.leadId]));
  const proposed = result.data.picks.flatMap((p) => {
    const leadId = byKey.get(p.id.replace(/[[\]\s]/g, ''));
    return leadId ? [{ leadId, score: p.score, reason: p.reason }] : [];
  });
  return done(settlePicks(proposed, stories, settings));
}

export async function markPicksFailed(s: Services, job: JobRow, error: Error) {
  await s.db
    .update(scrapeRuns)
    .set({ picks: { status: 'failed', items: [], error: error.message.slice(0, 500), at: new Date().toISOString() } })
    .where(eq(scrapeRuns.id, String(job.payload.runId)));
}
