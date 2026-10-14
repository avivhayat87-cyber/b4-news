// The social editor: before an article is published it writes the distribution plan (the
// frame, a post, a story, whether a reel fits, and the texts; services/social-plan.ts). Its
// settings live here, and so does what it learns: the plans the editors changed are read back
// into every new plan, so it chooses as they do without a learning call of its own.
import { type SocialAgentOverview, type SocialAgentSettings, SocialAgentSettings as Schema, type SocialCorrectionDto } from '@b4/shared';
import { type Db, and, appSettings, articleDrafts, count, desc, eq, gte, isNotNull, socialPlans } from '@b4/db';

const KEY = 'agent.social';
/** How many recent corrections every new plan reads. */
const CORRECTIONS = 8;

export async function getSocialSettings(db: Db): Promise<SocialAgentSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const parsed = Schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : Schema.parse({});
}

export async function saveSocialSettings(db: Db, staffId: string, input: SocialAgentSettings): Promise<SocialAgentSettings> {
  const value = Schema.parse(input);
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}

type Choice = SocialCorrectionDto['agent'];
const stills = (formats: string[]) => formats.filter((f) => f !== 'reel').sort().join(',');
const sameChoice = (a: Choice, b: Choice) => a.template === b.template && a.reel === b.reel && stills(a.formats) === stills(b.formats);

/** Plans an editor changed, newest first: what the social editor chose, and what the editor chose instead. */
export async function socialCorrections(db: Db, limit = CORRECTIONS): Promise<SocialCorrectionDto[]> {
  const rows = await db
    .select({ draftId: socialPlans.draftId, title: articleDrafts.title, template: socialPlans.template, formats: socialPlans.formats, aiChoice: socialPlans.aiChoice, at: socialPlans.updatedAt })
    .from(socialPlans)
    .innerJoin(articleDrafts, eq(socialPlans.draftId, articleDrafts.id))
    .where(and(eq(socialPlans.choicesBy, 'editor'), isNotNull(socialPlans.aiChoice)))
    .orderBy(desc(socialPlans.updatedAt))
    .limit(limit * 3);
  const out: SocialCorrectionDto[] = [];
  for (const r of rows) {
    const agent: Choice = { template: r.aiChoice!.template, formats: r.aiChoice!.formats, reel: r.aiChoice!.reel };
    const editor: Choice = { template: r.template, formats: r.formats.filter((f) => f !== 'reel'), reel: r.formats.includes('reel') };
    if (sameChoice(agent, editor)) continue;
    out.push({ draftId: r.draftId, title: r.title, agent, editor, at: r.at.toISOString() });
    if (out.length >= limit) break;
  }
  return out;
}

const choiceText = (c: Choice) => `frame=${c.template}, ${stills(c.formats) || 'nothing'}${c.reel ? ', reel' : ''}`;

/** What the social editor reads with every plan: the newsroom's instructions and its recent corrections. */
export async function socialGuidance(db: Db): Promise<string> {
  const st = await getSocialSettings(db);
  const corrections = await socialCorrections(db);
  return [
    st.instructions ? `Standing instructions from the editors:\n${st.instructions}` : '',
    st.reelGuidance ? `When a reel is worth its price, in the editors' words:\n${st.reelGuidance}` : '',
    corrections.length
      ? `Plans the editors recently changed (yours, then theirs; "reel" for you means you recommended one, for them that they approved it):\n${corrections.map((c) => `- "${c.title}": you chose ${choiceText(c.agent)}; they chose ${choiceText(c.editor)}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function socialAgentOverview(db: Db): Promise<SocialAgentOverview> {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const [planned] = await db.select({ n: count() }).from(socialPlans).where(and(isNotNull(socialPlans.aiChoice), gte(socialPlans.createdAt, since)));
  const [changed] = await db
    .select({ n: count() })
    .from(socialPlans)
    .where(and(isNotNull(socialPlans.aiChoice), eq(socialPlans.choicesBy, 'editor'), gte(socialPlans.createdAt, since)));
  return { settings: await getSocialSettings(db), corrections: await socialCorrections(db, 12), planned: planned?.n ?? 0, changed: changed?.n ?? 0 };
}
