// The editor agent: the AI that writes the new article from the source. The
// newsroom sets how far it moves from the source (wording, angle, structure),
// the length and the voice; the factual data always stays as in the source,
// and a fact check compares the two after every edit.
import { type EditorAgentSettings, type FactCheckDto, EditorAgentSettings as Schema } from '@b4/shared';
import { type Db, appSettings, articleDrafts, eq, scrapedItems } from '@b4/db';
import { errors } from '../../errors';
import { checkFacts } from '../../lib/facts';

const KEY = 'agent.editor';

export async function getEditorSettings(db: Db): Promise<EditorAgentSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const parsed = Schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : Schema.parse({});
}

export async function saveEditorSettings(db: Db, staffId: string, input: EditorAgentSettings): Promise<EditorAgentSettings> {
  const value = Schema.parse(input);
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}

const DIVERGENCE_RULE: Record<EditorAgentSettings['divergence'], string> = {
  light: "Stay close to the source: keep its structure and the order of its points, and write every sentence in new words.",
  medium: 'Rewrite fully: new wording and a new structure, keeping the source\'s angle.',
  strong: 'Write a different article: a fresh angle, lede and structure for an Israeli reader, built only on the facts of the source.',
};
const LENGTH_RULE: Record<EditorAgentSettings['length'], string> = {
  shorter: 'Length: about two thirds of the source; drop repetition and background first, never data.',
  same: 'Length: about the same as the source.',
  longer: 'Length: somewhat longer than the source, by explaining what the facts of the source mean for the reader (no new facts).',
};

/** The block appended to the rewrite prompt. The facts rule is fixed; the newsroom can't turn it off. */
export function editorGuidelines(st: EditorAgentSettings): string {
  return [
    '',
    'Editor agent settings (set by the newsroom):',
    `- ${DIVERGENCE_RULE[st.divergence]}`,
    `- ${LENGTH_RULE[st.length]}`,
    st.tone ? `- Voice: ${st.tone}` : '',
    st.instructions ? `- Standing instructions from the editors:\n${st.instructions}` : '',
    '- Factual data must survive the rewrite however far the wording moves: every number, percentage, amount, date, name and attributed quote of the source appears in the article exactly as in the source (translating units and currency names is fine). Never add a number, date or name that is not in the source.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function editorGuidelinesFor(db: Db): Promise<string> {
  return editorGuidelines(await getEditorSettings(db));
}

/** The draft's factual data against its source (the Hebrew translation of a foreign source). */
export async function draftFacts(db: Db, draftId: string): Promise<FactCheckDto> {
  const [row] = await db
    .select({
      title: articleDrafts.title,
      subtitle: articleDrafts.subtitle,
      body: articleDrafts.bodyText,
      sourceTitle: scrapedItems.title,
      sourceTitleHe: scrapedItems.titleHe,
      sourceIntro: scrapedItems.intro,
      sourceIntroHe: scrapedItems.introHe,
      sourceBody: scrapedItems.bodyText,
      sourceBodyHe: scrapedItems.bodyHe,
    })
    .from(articleDrafts)
    .leftJoin(scrapedItems, eq(articleDrafts.scrapedItemId, scrapedItems.id))
    .where(eq(articleDrafts.id, draftId))
    .limit(1);
  if (!row) throw errors.notFound('הכתבה');
  const source = [row.sourceTitleHe ?? row.sourceTitle, row.sourceIntroHe ?? row.sourceIntro, row.sourceBodyHe ?? row.sourceBody].filter(Boolean).join('\n');
  if (!source) return { hasSource: false, sourceCount: 0, missing: [], added: [] };
  const c = checkFacts(source, `${row.title}\n${row.subtitle}\n${row.body}`);
  const view = (f: { value: string; context: string }) => ({ value: f.value, context: f.context });
  return { hasSource: true, sourceCount: c.sourceCount, missing: c.missing.map(view), added: c.added.map(view) };
}
