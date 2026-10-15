// The agent team as the CMS shows it ("הגדרות" > "צוות הסוכנים"): each agent with the model it
// runs on and its skills (skills.ts), and what each did and cost in a period (a day, a month, a
// year, since the start, or between two days), from ai_jobs. Who the agents are is fixed here;
// what they know is edited in the CMS.
import {
  AGENT_IDS,
  type AgentCardDto,
  type AgentId,
  type AgentTeamDto,
  type AgentUsageDto,
  type AgentUsageQuery,
  type AgentUsageReportDto,
  NEWSROOM_FIXED_RULES,
} from '@b4/shared';
import { aiJobs, and, eq, gte, lt, sql } from '@b4/db';
import { AppError } from '../../errors';
import { textCostUsd } from '../ai/prices';
import type { Services } from '../context';
import { AGENT_MODEL, agentEngine } from './engine';
import { AGENT_SKILLS, RULES_KEY, skillSummaries } from './skills';

type AiJobType = (typeof aiJobs.$inferSelect)['type'];

/** Which agent does each kind of AI work. */
const JOB_AGENT: Record<AiJobType, AgentId> = {
  agent_turn: 'chief',
  rewrite: 'rewrite',
  refine: 'rewrite',
  classify: 'rewrite',
  social_caption: 'social',
  translate: 'translator',
  style_distill: 'learning',
  visual_prompt: 'visual',
  visual_learning: 'visual',
  article_images: 'visual',
  social_image: 'visual',
  social_video: 'visual',
  legal_review: 'reviewer',
  research: 'reporter',
  meeting: 'chief',
  discovery_pick: 'chief',
  ads: 'ads',
};

const ISRAEL = 'Asia/Jerusalem';

/** The day it is in Israel at a moment, as YYYY-MM-DD. */
export function israelDay(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ISRAEL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The moment a day (YYYY-MM-DD) begins in Israel. */
export function israelMidnight(day: string): Date {
  const midnightUtc = new Date(`${day}T00:00:00Z`);
  // Israel is UTC+2 or +3: the offset at that moment, from how Israel writes it.
  const there = new Date(midnightUtc.toLocaleString('en-US', { timeZone: ISRAEL }));
  const here = new Date(midnightUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(midnightUtc.getTime() - (there.getTime() - here.getTime()));
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** A real calendar day (2026-02-30 is not). */
const isDay = (day: string) => !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().startsWith(day);

/** The first moment of this month in Israel, and the month as YYYY-MM. */
export function israelMonthStart(now = new Date()): { start: Date; month: string } {
  const month = israelDay(now).slice(0, 7);
  return { start: israelMidnight(`${month}-01`), month };
}

/** The days a usage report covers, both included (from is null since the start). */
export function usageRange(q: AgentUsageQuery, now = new Date()): { from: string | null; to: string } {
  const today = israelDay(now);
  switch (q.period) {
    case 'day':
      return { from: today, to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'all':
      return { from: null, to: today };
    case 'custom':
      if (!q.from || !q.to || !isDay(q.from) || !isDay(q.to)) throw new AppError(400, 'bad_range', 'בחרו תאריך התחלה ותאריך סיום.');
      if (q.from > q.to) throw new AppError(400, 'bad_range', 'תאריך ההתחלה אחרי תאריך הסיום.');
      return { from: q.from, to: q.to };
  }
}

const noUsage = (): AgentUsageDto => ({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, partial: false });

async function usageBetween(s: Services, from: Date | null, until: Date): Promise<Map<AgentId, AgentUsageDto>> {
  const unpriced = sql`${aiJobs.costUsd} is null`;
  const rows = await s.db
    .select({
      type: aiJobs.type,
      model: aiJobs.model,
      calls: sql<number>`count(*)::int`,
      input: sql<number>`coalesce(sum(${aiJobs.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${aiJobs.outputTokens}), 0)::int`,
      priced: sql<string>`coalesce(sum(${aiJobs.costUsd}), 0)`,
      // Calls without a price of their own: a text call is priced from its tokens.
      unpricedCalls: sql<number>`(count(*) filter (where ${unpriced}))::int`,
      unpricedInput: sql<number>`coalesce(sum(${aiJobs.inputTokens}) filter (where ${unpriced}), 0)::int`,
      unpricedOutput: sql<number>`coalesce(sum(${aiJobs.outputTokens}) filter (where ${unpriced}), 0)::int`,
    })
    .from(aiJobs)
    .where(and(eq(aiJobs.status, 'succeeded'), lt(aiJobs.createdAt, until), from ? gte(aiJobs.createdAt, from) : undefined))
    .groupBy(aiJobs.type, aiJobs.model);
  const out = new Map<AgentId, AgentUsageDto>(AGENT_IDS.map((id) => [id, noUsage()]));
  for (const r of rows) {
    const u = out.get(JOB_AGENT[r.type])!;
    u.calls += r.calls;
    u.inputTokens += r.input;
    u.outputTokens += r.output;
    u.costUsd += Number(r.priced);
    if (r.unpricedCalls === 0) continue;
    const price = textCostUsd(r.model, r.unpricedInput, r.unpricedOutput);
    if (price !== null) u.costUsd += price;
    // The development stand-in costs nothing; anything else without a known price is billed elsewhere (Google).
    else if (!['fake', 'demo', 'placeholder'].some((m) => r.model.startsWith(m))) u.partial = true;
  }
  return out;
}

const rounded = (u: AgentUsageDto): AgentUsageDto => ({ ...u, costUsd: Math.round(u.costUsd * 10_000) / 10_000 });

/** What each agent did and cost in a period, and all of them together. */
export async function agentUsage(s: Services, q: AgentUsageQuery): Promise<AgentUsageReportDto> {
  const { from, to } = usageRange(q);
  const usage = await usageBetween(s, from ? israelMidnight(from) : null, israelMidnight(nextDay(to)));
  const total = noUsage();
  for (const u of usage.values()) {
    total.calls += u.calls;
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.costUsd += u.costUsd;
    total.partial ||= u.partial;
  }
  return { period: q.period, from, to, agents: AGENT_IDS.map((id) => ({ id, usage: rounded(usage.get(id)!) })), total: rounded(total) };
}

/** The team: each agent's model and skills, and the newsroom rules. */
export async function agentTeam(s: Services): Promise<AgentTeamDto> {
  const [skills, claude, gemini] = await Promise.all([
    skillSummaries(s.db, [...AGENT_IDS.flatMap((a) => AGENT_SKILLS[a]), RULES_KEY]),
    s.settings.integration('anthropic'),
    s.settings.integration('gemini'),
  ]);
  const [text, visual, chief] = await Promise.all([s.ai.text().catch(() => null), s.ai.visual().catch(() => null), agentEngine(s).catch(() => null)]);
  const model: Record<AgentId, { provider: string; model: string; live: boolean }> = {
    // The chat on its own model; the editorial meeting on the main one; the picks after a run on the fast one.
    chief: { provider: 'anthropic', model: [...new Set([AGENT_MODEL, claude.model, claude.modelFast].filter(Boolean))].join(' / '), live: Boolean(chief?.live) },
    // A deep research runs on the strongest model.
    reporter: { provider: 'anthropic', model: [claude.model, 'claude-opus-5-5'].filter(Boolean).join(' / '), live: Boolean(text?.live) },
    rewrite: { provider: 'anthropic', model: claude.model ?? '', live: Boolean(text?.live) },
    // The check on the fast model; a safer wording of a passage on the main one.
    reviewer: { provider: 'anthropic', model: [claude.modelFast, claude.model].filter(Boolean).join(' / '), live: Boolean(text?.live) },
    social: { provider: 'anthropic', model: claude.modelFast ?? '', live: Boolean(text?.live) },
    visual: { provider: 'google', model: gemini.agentModel ?? '', live: Boolean(visual?.live) },
    // Headlines go to the fast model, a whole article to the main one.
    translator: { provider: 'anthropic', model: [claude.modelFast, claude.model].filter(Boolean).join(' / '), live: Boolean(text?.live) },
    learning: { provider: 'anthropic', model: claude.model ?? '', live: Boolean(text?.live) },
    // Its words on the fast model; a picture it is asked for on the image model.
    ads: { provider: 'anthropic', model: [claude.modelFast, gemini.imageModel].filter(Boolean).join(' / '), live: Boolean(text?.live) },
  };
  const agents: AgentCardDto[] = AGENT_IDS.map((id) => ({
    id,
    ...model[id],
    skills: AGENT_SKILLS[id].map((k) => skills.get(k)).filter((x) => x !== undefined),
  }));
  return { agents, rules: skills.get(RULES_KEY)!, fixedRules: [...NEWSROOM_FIXED_RULES] };
}
