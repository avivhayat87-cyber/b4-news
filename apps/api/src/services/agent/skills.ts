// The agents' skills: their instructions, kept as versions in prompt_templates and read by the AI
// calls through activePrompt / writerPrompt. An admin rewrites a skill in the CMS (a new version,
// in use at once) or brings back an older one (copied as a new version under the admin's name, so
// a release never replaces it: see seedPrompts in @b4/db).
import { AGENT_IDS, type AgentId, type SkillDto, type SkillKind, type SkillSummary } from '@b4/shared';
import { type Db, and, eq, inArray, promptTemplates, users } from '@b4/db';
import { AppError, errors } from '../../errors';

/** Each agent's skills (prompt_templates keys), in the order the CMS shows them. */
export const AGENT_SKILLS: Record<AgentId, string[]> = {
  chief: ['agent.system', 'meeting.pitch'],
  reporter: ['research.system', 'research.write', 'research.update', 'research.accounts'],
  rewrite: ['rewrite.system', 'refine.system'],
  reviewer: ['review.system', 'review.fix'],
  social: ['social.plan', 'social.kit', 'social.caption'],
  visual: ['visual.image', 'reel.prompts', 'visual.learn', 'reel.image', 'reel.video'],
  translator: ['translate.system'],
  learning: ['learning.batch'],
};
/** The newsroom rules every writing agent reads after its own skill. */
export const RULES_KEY = 'newsroom.rules';
/** Sent to an image or video model, in English on purpose. */
const TEMPLATE_KEYS = ['reel.image', 'reel.video'];
/** Markers the code fills in: a new version must keep them, or the code has nowhere to put its part. */
const PLACEHOLDERS: Record<string, string[]> = {
  'rewrite.system': ['{{style_rules}}'],
  'reel.image': ['{{prompt}}'],
  'reel.video': ['{{prompt}}', '{{motion}}', '{{instruction}}'],
};

export const SKILL_KEYS: string[] = [...AGENT_IDS.flatMap((a) => AGENT_SKILLS[a]), RULES_KEY];
const kindOf = (key: string): SkillKind => (key === RULES_KEY ? 'rules' : TEMPLATE_KEYS.includes(key) ? 'template' : 'skill');

function known(key: string) {
  if (!SKILL_KEYS.includes(key)) throw errors.notFound('הסקיל');
}

async function versionsOf(db: Db, keys: string[]) {
  return db
    .select({ key: promptTemplates.key, version: promptTemplates.version, body: promptTemplates.body, isActive: promptTemplates.isActive, createdAt: promptTemplates.createdAt, author: users.fullName })
    .from(promptTemplates)
    .leftJoin(users, eq(promptTemplates.createdBy, users.id))
    .where(inArray(promptTemplates.key, keys));
}

/** The version in use per key (the newest active one, as activePrompt reads it). */
export async function skillSummaries(db: Db, keys: string[]): Promise<Map<string, SkillSummary>> {
  const rows = await versionsOf(db, keys);
  const out = new Map<string, SkillSummary>();
  for (const key of keys) {
    const mine = rows.filter((r) => r.key === key);
    const active = mine.filter((r) => r.isActive).sort((a, b) => b.version - a.version)[0];
    if (!active) continue;
    out.set(key, { key, kind: kindOf(key), version: active.version, versions: mine.length, updatedAt: active.createdAt.toISOString(), updatedBy: active.author });
  }
  return out;
}

export async function getSkill(db: Db, key: string): Promise<SkillDto> {
  known(key);
  const rows = (await versionsOf(db, [key])).sort((a, b) => b.version - a.version);
  const activeVersion = rows.find((r) => r.isActive)?.version;
  return {
    key,
    kind: kindOf(key),
    placeholders: PLACEHOLDERS[key] ?? [],
    versions: rows.map((r) => ({ version: r.version, body: r.body, isActive: r.version === activeVersion, createdAt: r.createdAt.toISOString(), createdBy: r.author })),
  };
}

/** A new version, in use at once; the others stay in the history. */
async function addVersion(db: Db, staffId: string, key: string, body: string) {
  await db.transaction(async (tx) => {
    const rows = await tx.select({ version: promptTemplates.version }).from(promptTemplates).where(eq(promptTemplates.key, key));
    const version = Math.max(0, ...rows.map((r) => r.version)) + 1;
    await tx.update(promptTemplates).set({ isActive: false }).where(eq(promptTemplates.key, key));
    await tx.insert(promptTemplates).values({ key, version, body, isActive: true, createdBy: staffId });
  });
}

/** An admin's own wording of a skill. */
export async function saveSkill(db: Db, staff: { id: string }, key: string, body: string): Promise<SkillDto> {
  known(key);
  const missing = (PLACEHOLDERS[key] ?? []).filter((p) => !body.includes(p));
  if (missing.length) throw new AppError(422, 'missing_placeholder', `צריך להשאיר בסקיל את הסימון ${missing.join(', ')}: שם המערכת מכניסה את החלק שלה.`);
  const current = (await getSkill(db, key)).versions.find((v) => v.isActive);
  if (current?.body === body) return getSkill(db, key);
  await addVersion(db, staff.id, key, body);
  return getSkill(db, key);
}

/** Brings back an older version, as a new version under the admin's name. */
export async function restoreSkill(db: Db, staff: { id: string }, key: string, version: number): Promise<SkillDto> {
  known(key);
  const [row] = await db.select({ body: promptTemplates.body, isActive: promptTemplates.isActive }).from(promptTemplates).where(and(eq(promptTemplates.key, key), eq(promptTemplates.version, version))).limit(1);
  if (!row) throw errors.notFound('הגרסה');
  if (!row.isActive) await addVersion(db, staff.id, key, row.body);
  return getSkill(db, key);
}
