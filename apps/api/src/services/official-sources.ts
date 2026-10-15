// The official-sources registry: bodies (a ministry, the central bank, a regulator…) whose own
// sites and verified social accounts count as official sources for the research reporter, under
// their names in the sources line. An account is verified when the body's official site links to
// it, as a browser draws the page (the code checks; no AI). A weekly job reads every body's site
// again, and searches (two searches at most, for a few bodies a week) for accounts the home page
// doesn't link; those too enter only when an official page links to them, else they wait for an
// admin. The research reporter's settings and source rules are agent/researcher.ts.
import { type OfficialSourceDto, type OfficialSourceInput, type RegistryOverviewDto } from '@b4/shared';
import { type Db, type OfficialAccountRecord, and, appSettings, asc, eq, inArray, jobs, officialSources } from '@b4/db';
import { AppError, errors } from '../errors';
import { enqueue, type JobRow } from '../lib/jobs';
import { decodeText } from '../lib/safe-fetch';
import { accountOf, accountsIn } from '../lib/social-links';
import { activePrompt, tracked } from './ai';
import { textCostUsd, WEB_SEARCH_USD } from './ai/prices';
import type { Services } from './context';
import { getResearcherSettings } from './agent/researcher';
import { researchSpentUsd } from './research';

export const REGISTRY_JOB = 'registry.update';
export const REGISTRY_TICK_JOB = 'registry.tick';
const LAST_RUN_KEY = 'registry.last_run';
const WEEK_MS = 7 * 24 * 3600_000;
const TICK_MS = 6 * 3600_000;
/** Bodies searched for accounts per run (each costs up to two searches). */
const SEARCHES_PER_RUN = 5;

type Staff = { id: string; fullName: string };
type Row = typeof officialSources.$inferSelect;
type LastRun = NonNullable<RegistryOverviewDto['lastRun']>;

/** What the research reporter reads: each active body's own domains and its verified accounts. */
export type RegistryEntry = { name: string; domains: string[]; accounts: string[] };

export async function registryForResearch(db: Db): Promise<RegistryEntry[]> {
  const rows = await db.select().from(officialSources).where(eq(officialSources.active, true));
  return rows.map((r) => ({ name: r.name, domains: r.domains, accounts: r.accounts.filter((a) => a.status === 'verified').map((a) => a.key) }));
}

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

/** Whether an address is under one of a body's domains (a host and its subdomains, or a host and a path). */
export function underDomain(raw: string, domain: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const d = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  if (d.includes('/')) return `${hostOf(u)}${u.pathname.toLowerCase()}`.startsWith(d);
  const host = hostOf(u);
  return host === d || host.endsWith(`.${d}`);
}

// ---------------------------------------------------------------------------
// Reading and editing (an admin's call: it decides what counts as official)
// ---------------------------------------------------------------------------

function toDto(r: Row): OfficialSourceDto {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as OfficialSourceDto['kind'],
    homepage: r.homepage,
    domains: r.domains,
    accounts: r.accounts.map((a) => ({ ...a, platform: a.platform as OfficialSourceDto['accounts'][number]['platform'] })),
    active: r.active,
    addedBy: r.addedBy as OfficialSourceDto['addedBy'],
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    lastError: r.lastError,
  };
}

export async function registryOverview(s: Services): Promise<RegistryOverviewDto> {
  const rows = await s.db.select().from(officialSources).orderBy(asc(officialSources.name));
  const [last] = await s.db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAST_RUN_KEY)).limit(1);
  const [running] = await s.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, REGISTRY_JOB), inArray(jobs.status, ['queued', 'running']))).limit(1);
  return { sources: rows.map(toDto), lastRun: (last?.value as LastRun | undefined) ?? null, running: Boolean(running) };
}

async function load(s: Services, id: string): Promise<Row> {
  const [row] = await s.db.select().from(officialSources).where(eq(officialSources.id, id)).limit(1);
  if (!row) throw errors.notFound('הגוף');
  return row;
}

/** The domains a body's site is under: what the admin gave, else its home page's host. */
function domainsOf(input: OfficialSourceInput): string[] {
  const given = input.domains.map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')).filter(Boolean);
  return given.length ? [...new Set(given)] : [hostOf(new URL(input.homepage))];
}

export async function createSource(s: Services, input: OfficialSourceInput): Promise<OfficialSourceDto> {
  const [row] = await s.db
    .insert(officialSources)
    .values({ name: input.name, kind: input.kind, homepage: input.homepage, domains: domainsOf(input), active: input.active, addedBy: 'admin' })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new AppError(409, 'source_exists', 'הגוף הזה (אותו אתר רשמי) כבר במאגר.');
  return toDto(row);
}

export async function updateSource(s: Services, id: string, input: OfficialSourceInput): Promise<OfficialSourceDto> {
  await load(s, id);
  const [row] = await s.db
    .update(officialSources)
    .set({ name: input.name, kind: input.kind, homepage: input.homepage, domains: domainsOf(input), active: input.active, updatedAt: new Date() })
    .where(eq(officialSources.id, id))
    .returning();
  return toDto(row!);
}

export async function deleteSource(s: Services, id: string): Promise<void> {
  await load(s, id);
  await s.db.delete(officialSources).where(eq(officialSources.id, id));
}

/** An account an admin adds by hand: verified on the admin's word. */
export async function addAccount(s: Services, id: string, url: string): Promise<OfficialSourceDto> {
  const row = await load(s, id);
  const a = accountOf(url);
  if (!a) throw new AppError(422, 'not_an_account', 'זו לא כתובת של חשבון ברשת (X, טלגרם, פייסבוק, אינסטגרם, יוטיוב, לינקדאין, טיקטוק או Threads).');
  const accounts = row.accounts.filter((x) => x.key !== a.key);
  accounts.push({ platform: a.platform, key: a.key, url, status: 'verified', foundBy: 'admin', evidence: null, checkedAt: new Date().toISOString() });
  return saveAccounts(s, id, accounts);
}

/** A pending account approved by an admin, or any account taken out. */
export async function setAccount(s: Services, id: string, url: string, action: 'approve' | 'remove'): Promise<OfficialSourceDto> {
  const row = await load(s, id);
  const key = accountOf(url)?.key ?? url;
  if (!row.accounts.some((x) => x.key === key)) throw errors.notFound('החשבון');
  const accounts = action === 'remove' ? row.accounts.filter((x) => x.key !== key) : row.accounts.map((x) => (x.key === key ? { ...x, status: 'verified' as const, checkedAt: new Date().toISOString() } : x));
  return saveAccounts(s, id, accounts);
}

async function saveAccounts(s: Services, id: string, accounts: OfficialAccountRecord[]): Promise<OfficialSourceDto> {
  const [row] = await s.db.update(officialSources).set({ accounts, updatedAt: new Date() }).where(eq(officialSources.id, id)).returning();
  return toDto(row!);
}

// ---------------------------------------------------------------------------
// The weekly check
// ---------------------------------------------------------------------------

/** The links of a page: as a browser draws it when there is one (many official sites build theirs in the browser, or refuse plain requests), else its HTML. */
async function linksOf(s: Services, url: string): Promise<string[]> {
  if (s.capture.available) return s.capture.links(url);
  const res = await s.fetch(url, { allowTypes: ['text/html', 'application/xhtml'] });
  const html = decodeText(res);
  return [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => {
    try {
      return new URL(m[1]!, res.url).toString();
    } catch {
      return '';
    }
  });
}

/** Why a body's page couldn't be read, for the admin. A site that refuses automatic checks is not worked around. */
function readError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/HTTP 40[13]|HTTP 429/.test(raw)) return 'האתר חוסם בדיקה אוטומטית (למשל Cloudflare). החשבונות נשארו כמו שהם; אפשר להוסיף חשבון ידנית.';
  if (/HTTP 404|HTTP 410/.test(raw)) return 'העמוד לא נמצא באתר. כדאי לבדוק את כתובת האתר הרשמי.';
  if (/RESET|REFUSED|TIMED_OUT|Timeout|ENOTFOUND|EAI_AGAIN|ECONN/i.test(raw)) return 'לא הצלחנו להתחבר לאתר. ננסה שוב בבדיקה הבאה.';
  return 'לא הצלחנו לקרוא את האתר. ננסה שוב בבדיקה הבאה.';
}

export async function requestRegistryUpdate(s: Services, staffId: string | null): Promise<boolean> {
  const [running] = await s.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, REGISTRY_JOB), inArray(jobs.status, ['queued', 'running']))).limit(1);
  if (running) return false;
  await enqueue(s.db, REGISTRY_JOB, {}, { createdBy: staffId, maxAttempts: 1 });
  return true;
}

/**
 * Every active body's site read again: accounts it links are added (or confirmed), and ones it
 * no longer links are marked "missing" (kept: the admin decides). An account linked from several
 * bodies' pages is the hosting portal's own (gov.il's footer) and goes only to a body whose home
 * page is that portal itself. Then a few bodies with no account on X or Telegram are searched.
 */
export async function runRegistryUpdate(s: Services, job: JobRow) {
  const rows = await s.db.select().from(officialSources).where(eq(officialSources.active, true));
  const now = new Date().toISOString();
  const read = new Map<string, { platform: string; key: string; url: string }[]>();
  const failed = new Map<string, string>();
  for (const r of rows) {
    try {
      const found = accountsIn(await linksOf(s, r.homepage));
      // No account at all where the site used to link some: a page drawn without them (a check page), not a change.
      if (!found.length && r.accounts.some((a) => a.foundBy === 'site' && a.status === 'verified')) failed.set(r.id, 'האתר לא הציג קישורים לרשתות בבדיקה הזאת. החשבונות נשארו כמו שהם.');
      else read.set(r.id, found);
    } catch (e) {
      failed.set(r.id, readError(e));
    }
  }
  const seenOn = new Map<string, number>();
  for (const found of read.values()) for (const a of found) seenOn.set(a.key, (seenOn.get(a.key) ?? 0) + 1);
  const isPortal = (r: Row) => new URL(r.homepage).pathname.replace(/\/+$/, '') === '';

  let added = 0;
  let pending = 0;
  for (const r of rows) {
    const found = read.get(r.id);
    if (!found) {
      await s.db.update(officialSources).set({ lastCheckedAt: new Date(), lastError: failed.get(r.id) ?? null }).where(eq(officialSources.id, r.id));
      continue;
    }
    const own = found.filter((a) => (seenOn.get(a.key) ?? 0) < 2 || isPortal(r));
    const accounts: OfficialAccountRecord[] = r.accounts.map((x) => {
      const again = own.some((a) => a.key === x.key);
      if (again) return { ...x, status: 'verified', checkedAt: now };
      // Only what the site itself had linked can stop being linked.
      return x.foundBy === 'site' && x.status === 'verified' ? { ...x, status: 'missing', checkedAt: now } : x;
    });
    for (const a of own) {
      if (accounts.some((x) => x.key === a.key)) continue;
      accounts.push({ platform: a.platform, key: a.key, url: a.url, status: 'verified', foundBy: 'site', evidence: r.homepage, checkedAt: now });
      added++;
    }
    await s.db.update(officialSources).set({ accounts, lastCheckedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(officialSources.id, r.id));
  }

  // A few searches a week, within the reporter's budget.
  let cost = 0;
  const settings = await getResearcherSettings(s.db);
  if ((await researchSpentUsd(s)) < settings.monthlyBudgetUsd) {
    const fresh = await s.db.select().from(officialSources).where(eq(officialSources.active, true));
    const wanting = fresh.filter((r) => !failed.has(r.id) && !r.accounts.some((a) => a.status !== 'missing' && (a.platform === 'x' || a.platform === 'telegram'))).slice(0, SEARCHES_PER_RUN);
    if (wanting.length) {
      const textAi = await s.ai.text();
      const prompt = await activePrompt(s.db, 'research.accounts');
      for (const r of wanting) {
        try {
          const { result } = await tracked(
            s.db,
            { type: 'research', provider: textAi.provider, requestedBy: job.createdBy, promptKey: 'research.accounts', promptVersion: prompt.version, costOf: (x) => (textAi.live ? (textCostUsd(x.usage.model, x.usage.inputTokens, x.usage.outputTokens) ?? 0) + x.searches * WEB_SEARCH_USD : null) },
            () => textAi.findAccounts({ systemPrompt: prompt.body, body: { name: r.name, homepage: r.homepage, domains: r.domains, known: r.accounts.map((a) => a.url) } }),
          );
          if (textAi.live) cost += (textCostUsd(result.usage.model, result.usage.inputTokens, result.usage.outputTokens) ?? 0) + result.searches * WEB_SEARCH_USD;
          const accounts = [...r.accounts];
          for (const suggested of result.data.accounts) {
            const a = accountOf(suggested.url);
            if (!a || accounts.some((x) => x.key === a.key)) continue;
            // Verified only when the evidence is the body's own page and it really links the account.
            const ownPage = r.domains.some((d) => underDomain(suggested.evidence_url, d));
            const links = ownPage ? await linksOf(s, suggested.evidence_url).catch(() => [] as string[]) : [];
            const verified = accountsIn(links).some((x) => x.key === a.key);
            accounts.push({ platform: a.platform, key: a.key, url: suggested.url, status: verified ? 'verified' : 'pending', foundBy: 'search', evidence: suggested.evidence_url || null, checkedAt: now });
            if (verified) added++;
            else pending++;
          }
          await s.db.update(officialSources).set({ accounts, updatedAt: new Date() }).where(eq(officialSources.id, r.id));
        } catch (e) {
          s.log.warn({ body: r.name, err: e instanceof Error ? e.message : e }, 'registry: the account search failed');
        }
      }
    }
  }

  const lastRun: LastRun = { at: now, checked: rows.length, added, pending, errors: failed.size, costUsd: Math.round(cost * 10_000) / 10_000 };
  await s.db
    .insert(appSettings)
    .values({ key: LAST_RUN_KEY, value: lastRun })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: lastRun, updatedAt: new Date() } });
  return lastRun;
}

/** Every six hours (live only): a week after the last check, the next one. */
export async function runRegistryTick(s: Services, _job: JobRow) {
  try {
    const [last] = await s.db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAST_RUN_KEY)).limit(1);
    const at = (last?.value as LastRun | undefined)?.at;
    if (!at || Date.now() - new Date(at).getTime() >= WEEK_MS) return { queued: await requestRegistryUpdate(s, null) };
    return { queued: false };
  } finally {
    await ensureRegistryTick(s.db, new Date(Date.now() + TICK_MS));
  }
}

export async function ensureRegistryTick(db: Db, runAt = new Date()) {
  const [queued] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, REGISTRY_TICK_JOB), eq(jobs.status, 'queued'))).limit(1);
  if (!queued) await enqueue(db, REGISTRY_TICK_JOB, {}, { runAt, maxAttempts: 1 });
}
