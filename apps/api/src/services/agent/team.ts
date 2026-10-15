// The agent team as the CMS shows it ("הגדרות" > "צוות הסוכנים"): each agent with the model it
// runs on, its skills (skills.ts), and what it did and cost this month, from ai_jobs. Who the
// agents are is fixed here; what they know is edited in the CMS.
import { AGENT_IDS, type AgentCardDto, type AgentId, type AgentTeamDto, type AgentUsageDto, NEWSROOM_FIXED_RULES } from '@b4/shared';
import { aiJobs, and, eq, gte, sql } from '@b4/db';
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
};

/** The first moment of this month in Israel, and the month as YYYY-MM. */
export function israelMonthStart(now = new Date()): { start: Date; month: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  const midnightUtc = new Date(`${p.year}-${p.month}-01T00:00:00Z`);
  // Israel is UTC+2 or +3: the offset at that moment, from how Israel writes it.
  const there = new Date(midnightUtc.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const here = new Date(midnightUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return { start: new Date(midnightUtc.getTime() - (there.getTime() - here.getTime())), month: `${p.year}-${p.month}` };
}

async function usageSince(s: Services, since: Date): Promise<Map<AgentId, AgentUsageDto>> {
  const rows = await s.db
    .select({
      type: aiJobs.type,
      model: aiJobs.model,
      calls: sql<number>`count(*)::int`,
      input: sql<number>`coalesce(sum(${aiJobs.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${aiJobs.outputTokens}), 0)::int`,
      priced: sql<string | null>`sum(${aiJobs.costUsd})`,
    })
    .from(aiJobs)
    .where(and(gte(aiJobs.createdAt, since), eq(aiJobs.status, 'succeeded')))
    .groupBy(aiJobs.type, aiJobs.model);
  const out = new Map<AgentId, AgentUsageDto>(AGENT_IDS.map((id) => [id, { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, partial: false }]));
  for (const r of rows) {
    const u = out.get(JOB_AGENT[r.type])!;
    u.calls += r.calls;
    u.inputTokens += r.input;
    u.outputTokens += r.output;
    const price = textCostUsd(r.model, r.input, r.output);
    if (r.priced !== null) u.costUsd += Number(r.priced);
    else if (price !== null) u.costUsd += price;
    // The development stand-in costs nothing; anything else without a known price is billed elsewhere (Google).
    else if (!['fake', 'demo', 'placeholder'].some((m) => r.model.startsWith(m))) u.partial = true;
  }
  for (const u of out.values()) u.costUsd = Math.round(u.costUsd * 10_000) / 10_000;
  return out;
}

/** The team: each agent's model, skills and usage this month, and the newsroom rules. */
export async function agentTeam(s: Services): Promise<AgentTeamDto> {
  const { start, month } = israelMonthStart();
  const [usage, skills, claude, gemini] = await Promise.all([
    usageSince(s, start),
    skillSummaries(s.db, [...AGENT_IDS.flatMap((a) => AGENT_SKILLS[a]), RULES_KEY]),
    s.settings.integration('anthropic'),
    s.settings.integration('gemini'),
  ]);
  const [text, visual, chief] = await Promise.all([s.ai.text().catch(() => null), s.ai.visual().catch(() => null), agentEngine(s).catch(() => null)]);
  const model: Record<AgentId, { provider: string; model: string; live: boolean }> = {
    // The chat on its own model; the editorial meeting on the main one.
    chief: { provider: 'anthropic', model: [AGENT_MODEL, claude.model].filter(Boolean).join(' / '), live: Boolean(chief?.live) },
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
  };
  const agents: AgentCardDto[] = AGENT_IDS.map((id) => ({
    id,
    ...model[id],
    skills: AGENT_SKILLS[id].map((k) => skills.get(k)).filter((x) => x !== undefined),
    usage: usage.get(id)!,
  }));
  return { agents, rules: skills.get(RULES_KEY)!, fixedRules: [...NEWSROOM_FIXED_RULES], month };
}
