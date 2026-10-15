// The research reporter's settings (budget, default depth, the approved sources, screenshots) and
// its source rules: which source may back a fact. The research itself is services/research.ts.
import { NEWS_DOMAINS, OFFICIAL_DOMAINS, type ResearcherSettings, ResearcherSettings as Schema, SOCIAL_DOMAINS, type SourceKind } from '@b4/shared';
import { type Db, appSettings, eq } from '@b4/db';

const KEY = 'agent.research';

export async function getResearcherSettings(db: Db): Promise<ResearcherSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const parsed = Schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : Schema.parse({});
}

export async function saveResearcherSettings(db: Db, staffId: string, input: ResearcherSettings): Promise<ResearcherSettings> {
  const value = Schema.parse(input);
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}

/** The approved list as entries: "gov.example" or an account address ("x.com/bank_of_israel"). */
export function approvedEntries(settings: ResearcherSettings): string[] {
  return settings.approvedSources
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, ''))
    .filter((line) => line.length > 2 && !line.startsWith('#'));
}

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace(/^mobile\./, '');
const under = (host: string, domains: readonly string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/** Whether the address is on the approved list: its whole site, or an account address and what is under it. */
function onList(url: URL, entries: string[]): boolean {
  const host = hostOf(url);
  const path = `${host}${url.pathname.toLowerCase().replace(/\/+$/, '')}`;
  return entries.some((e) => (e.includes('/') ? path === e || path.startsWith(`${e}/`) : host === e || host.endsWith(`.${e}`)));
}

/**
 * A source's kind and whether it may back a fact, by its address first and the reporter's word
 * second: news sites never may, social posts only from an approved account, official sites always.
 * An unknown site may when the reporter marked it as the subject's own (a company, a person) or
 * as official; the editor sees which in the research file.
 */
export function judgeSource(raw: string, claimed: SourceKind, entries: string[]): { kind: SourceKind; approved: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = hostOf(url);
  const listed = onList(url, entries);
  if (under(host, NEWS_DOMAINS)) return { kind: 'news', approved: listed };
  if (under(host, SOCIAL_DOMAINS)) return { kind: 'social', approved: listed };
  if (under(host, ['wikipedia.org'])) return { kind: 'wiki', approved: false };
  if (under(host, OFFICIAL_DOMAINS)) return { kind: 'official', approved: true };
  if (listed) return { kind: claimed === 'news' || claimed === 'wiki' ? 'other' : claimed, approved: true };
  if (claimed === 'official' || claimed === 'company' || claimed === 'person') return { kind: claimed, approved: true };
  return { kind: claimed === 'wiki' ? 'other' : claimed, approved: false };
}
