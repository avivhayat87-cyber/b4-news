// The chief editor places a batch on the site (the "desk.plan" skill): when the AI has written every
// article of a magazine (or a single saved one), one call on the fast model reads the batch and what
// the home page shows now, and decides for each article whether it is the main story, a hot one or
// only in its section, whether it goes on the breaking-news ticker, and its section when discovery
// left none. What it chose is kept apart (article_drafts.desk_plan): an untouched choice is approved,
// an editor's change wins, and the next plans read those changes (no learning call of its own).
import { CATEGORIES, CATEGORY_SLUGS, type DeskPlanDto, TICKER_SIZE } from '@b4/shared';
import {
  type DeskPlanRecord,
  and,
  articleDrafts,
  articles,
  asc,
  categories,
  desc,
  eq,
  gte,
  homepageSlots,
  inArray,
  isNotNull,
  jobs,
  magazines,
  scrapeRuns,
  sql,
} from '@b4/db';
import { AppError } from '../errors';
import { enqueue, type JobRow } from '../lib/jobs';
import { activePrompt, tracked } from './ai';
import { textCostUsd } from './ai/prices';
import type { Services } from './context';
import { type DraftRow, loadDraft } from './drafts';

export const DESK_PLAN_JOB = 'desk.plan';
const AI_BUSY = ['queued_ai', 'ai_processing'] as const;
/** Articles still to place: written, not published or set aside. */
const PLACEABLE = ['editing', 'text_final', 'ready'] as const;
/** Corrections the next plan reads, the most recent first. */
const CORRECTIONS = 8;

type Target = { magazineId: string } | { draftId: string };
const targetOf = (d: Pick<DraftRow, 'id' | 'magazineId'>): Target => (d.magazineId ? { magazineId: d.magazineId } : { draftId: d.id });

async function planPending(s: Services, target: Target): Promise<boolean> {
  const key = 'magazineId' in target ? 'magazineId' : 'draftId';
  const value = 'magazineId' in target ? target.magazineId : target.draftId;
  const [job] = await s.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, DESK_PLAN_JOB), inArray(jobs.status, ['queued', 'running']), sql`${jobs.payload}->>${key} = ${value}`))
    .limit(1);
  return Boolean(job);
}

/**
 * After a rewrite: once no article of the batch is still being written, the chief editor places it.
 * An article it placed already (a rewrite tried again) doesn't ask again; one added to the batch
 * later does, and the plan then changes only what the editors left as the chief editor chose.
 */
export async function queueDeskPlan(s: Services, draftId: string, staffId: string | null): Promise<void> {
  const draft = await loadDraft(s.db, draftId);
  if (draft.deskPlan) return;
  const target = targetOf(draft);
  if ('magazineId' in target) {
    const [busy] = await s.db
      .select({ id: articleDrafts.id })
      .from(articleDrafts)
      .where(and(eq(articleDrafts.magazineId, target.magazineId), inArray(articleDrafts.status, [...AI_BUSY])))
      .limit(1);
    if (busy) return;
  }
  if (await planPending(s, target)) return;
  await enqueue(s.db, DESK_PLAN_JOB, target, { draftId: 'draftId' in target ? target.draftId : undefined, createdBy: staffId, maxAttempts: 1 });
}

/** "Ask the chief editor again": places the batch anew, changing only what the editors left as it chose. */
export async function requestDeskPlan(s: Services, staff: { id: string }, target: Target): Promise<void> {
  if (await planPending(s, target)) throw new AppError(409, 'desk_busy', 'העורך הראשי כבר מסדר את הכתבות. חכו רגע.');
  await enqueue(s.db, DESK_PLAN_JOB, target, { draftId: 'draftId' in target ? target.draftId : undefined, createdBy: staff.id, maxAttempts: 1 });
}

const hoursAgo = (at: Date) => {
  const h = Math.round((Date.now() - at.getTime()) / 3_600_000);
  return h < 1 ? 'עכשיו' : h < 48 ? `לפני ${h} שעות` : `לפני ${Math.round(h / 24)} ימים`;
};

/** What the home page shows now, as the chief editor reads it. */
async function homepageNow(s: Services) {
  const zone = async (z: 'main' | 'trending') =>
    (
      await s.db
        .select({ title: articles.title, at: articles.publishedAt })
        .from(homepageSlots)
        .innerJoin(articles, eq(homepageSlots.articleId, articles.id))
        .where(and(eq(homepageSlots.zone, z), eq(articles.status, 'published')))
        .orderBy(asc(homepageSlots.position))
    ).map((r) => `${r.title} (${hoursAgo(r.at)})`);
  const ticker = (
    await s.db
      .select({ title: articles.title, at: articles.tickerAt })
      .from(articles)
      .where(and(isNotNull(articles.tickerAt), eq(articles.status, 'published')))
      .orderBy(desc(articles.tickerAt))
      .limit(TICKER_SIZE)
  ).map((r) => `${r.title} (${hoursAgo(r.at!)})`);
  return { main: await zone('main'), trending: await zone('trending'), ticker };
}

const PLACE_NAME = { main: 'כתבה ראשית', trending: 'חדשות חמות', none: 'קטגוריה בלבד' } as const;

/** Where the editors changed the chief editor's choice lately: what the next plans learn from. */
async function recentCorrections(s: Services): Promise<string[]> {
  const rows = await s.db
    .select({ title: articleDrafts.title, plan: articleDrafts.deskPlan, placement: articleDrafts.placement, ticker: articleDrafts.ticker })
    .from(articleDrafts)
    .where(and(eq(articleDrafts.status, 'published'), isNotNull(articleDrafts.deskPlan), gte(articleDrafts.updatedAt, new Date(Date.now() - 30 * 86_400_000))))
    .orderBy(desc(articleDrafts.updatedAt))
    .limit(60);
  const out: string[] = [];
  for (const r of rows) {
    if (!r.plan) continue;
    const parts: string[] = [];
    if (r.plan.placement !== r.placement) parts.push(`בחרת "${PLACE_NAME[r.plan.placement]}" והעורכים שינו ל"${PLACE_NAME[r.placement]}"`);
    if (r.plan.ticker !== r.ticker) parts.push(r.ticker ? 'לא שמת במבזקים והעורכים הוסיפו' : 'שמת במבזקים והעורכים הורידו');
    if (parts.length) out.push(`${r.title}: ${parts.join('; ')}`);
    if (out.length >= CORRECTIONS) break;
  }
  return out;
}

/** The discovery score of each article (the chief editor's pick when its run was scanned), by its originals. */
async function discoveryScores(s: Services, rows: DraftRow[]): Promise<Map<string, number>> {
  const magazineIds = [...new Set(rows.flatMap((r) => (r.magazineId ? [r.magazineId] : [])))];
  if (magazineIds.length === 0) return new Map();
  const runs = await s.db
    .select({ picks: scrapeRuns.picks })
    .from(magazines)
    .innerJoin(scrapeRuns, eq(magazines.fromRunId, scrapeRuns.id))
    .where(inArray(magazines.id, magazineIds));
  const byItem = new Map(runs.flatMap((r) => (r.picks?.items ?? []).map((p) => [p.itemId, p.score] as const)));
  const out = new Map<string, number>();
  for (const r of rows) {
    const score = [r.scrapedItemId, ...r.extraItemIds].map((id) => (id ? byItem.get(id) : undefined)).find((x) => x !== undefined);
    if (score !== undefined) out.set(r.id, score);
  }
  return out;
}

const israelToday = () => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

/** Whether an editor has changed a field since the chief editor chose it (an untouched field may be placed again). */
function untouched(d: DraftRow, field: 'placement' | 'ticker'): boolean {
  if (field === 'placement') return d.deskPlan ? d.placement === d.deskPlan.placement : d.placement === 'none';
  return d.deskPlan ? d.ticker === d.deskPlan.ticker : !d.ticker;
}

export async function runDeskPlan(s: Services, job: JobRow) {
  const target: Target = job.payload.magazineId ? { magazineId: String(job.payload.magazineId) } : { draftId: String(job.payload.draftId) };
  const rows = (
    'magazineId' in target
      ? await s.db.select().from(articleDrafts).where(eq(articleDrafts.magazineId, target.magazineId)).orderBy(asc(articleDrafts.position))
      : [await loadDraft(s.db, target.draftId)]
  ).filter((r) => (PLACEABLE as readonly string[]).includes(r.status));
  if (rows.length === 0) return { skipped: 'nothing to place' };

  const cats = await s.db.select({ id: categories.id, slug: categories.slug }).from(categories);
  const slugOf = (id: number | null) => cats.find((c) => c.id === id)?.slug ?? null;
  const nameOf = (slug: string | null) => CATEGORIES.find((c) => c.slug === slug)?.name ?? null;
  const [template, homepage, corrections, scores, textAi] = await Promise.all([activePrompt(s.db, 'desk.plan'), homepageNow(s), recentCorrections(s), discoveryScores(s, rows), s.ai.text()]);
  const ids = new Map(rows.map((r, i) => [`a${i + 1}`, r]));
  const { result } = await tracked(
    s.db,
    {
      type: 'desk_plan',
      provider: textAi.provider,
      draftId: 'draftId' in target ? target.draftId : null,
      requestedBy: job.createdBy,
      promptKey: 'desk.plan',
      promptVersion: template.version,
      costOf: (r) => (textAi.live ? textCostUsd(r.usage.model, r.usage.inputTokens, r.usage.outputTokens) : null),
    },
    () =>
      textAi.deskPlan({
        systemPrompt: template.body,
        today: israelToday(),
        articles: [...ids].map(([id, r]) => ({
          id,
          title: r.title,
          subtitle: r.subtitle,
          opening: r.bodyText.replace(/\s+/g, ' ').trim().slice(0, 400),
          section: nameOf(slugOf(r.categoryId)),
          sites: 1 + r.extraItemIds.length,
          score: scores.get(r.id) ?? null,
        })),
        homepage,
        sections: CATEGORIES.map((c) => ({ slug: c.slug, name: c.name })),
        corrections,
      }),
  );

  // The code's rules, whatever the model answered: one main story per batch (the best ranked), a known section only.
  const items = result.data.items.filter((x) => ids.has(x.id)).sort((a, b) => a.rank - b.rank);
  const lead = items.find((x) => x.placement === 'main')?.id;
  const at = new Date().toISOString();
  let placed = 0;
  for (const x of items) {
    const d = ids.get(x.id)!;
    const placement = x.placement === 'main' && x.id !== lead ? 'trending' : x.placement;
    const fresh = await loadDraft(s.db, d.id);
    if (!(PLACEABLE as readonly string[]).includes(fresh.status)) continue;
    const set: Partial<typeof articleDrafts.$inferInsert> = {};
    if (untouched(fresh, 'placement')) set.placement = placement;
    if (untouched(fresh, 'ticker')) set.ticker = x.ticker;
    // A section only where there is none (or it is still the chief editor's own earlier choice).
    let category: string | null = fresh.deskPlan?.category && slugOf(fresh.categoryId) === fresh.deskPlan.category ? fresh.deskPlan.category : null;
    if (!fresh.categoryId && x.section && (CATEGORY_SLUGS as readonly string[]).includes(x.section)) {
      const id = cats.find((c) => c.slug === x.section)?.id;
      if (id) {
        set.categoryId = id;
        category = x.section;
      }
    }
    const plan: DeskPlanRecord = { placement, ticker: x.ticker, category, reason: x.reason.trim(), at };
    // Only the place, not the text: an editor typing meanwhile is not in the way.
    await s.db
      .update(articleDrafts)
      .set({ ...set, deskPlan: plan })
      .where(and(eq(articleDrafts.id, d.id), inArray(articleDrafts.status, [...PLACEABLE])));
    placed++;
  }
  return { placed };
}

/** The chief editor's choice as the CMS shows it, with what the editors changed since. */
export function deskPlanDto(plan: DeskPlanRecord | null, now: { placement: DeskPlanRecord['placement']; ticker: boolean; category: string | null }): DeskPlanDto | null {
  if (!plan) return null;
  const changed: DeskPlanDto['changed'] = [];
  if (plan.placement !== now.placement) changed.push('placement');
  if (plan.ticker !== now.ticker) changed.push('ticker');
  if (plan.category && plan.category !== now.category) changed.push('category');
  return { placement: plan.placement, ticker: plan.ticker, category: plan.category, reason: plan.reason, at: plan.at, changed };
}
