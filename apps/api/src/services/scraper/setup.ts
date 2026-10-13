// Background job "source.setup": detect a site's feed, save the trigger, test it.
// Approval stays a deliberate developer/admin click.
import type { SourceRegion } from '@b4/shared';
import { and, eq, inArray, isNotNull, jobs, sources, sql } from '@b4/db';
import { audit } from '../../lib/audit';
import { PermanentJobError, enqueue, type JobRow } from '../../lib/jobs';
import type { Services } from '../context';
import { autodetect } from './autodetect';

export async function queueSourceSetup(s: Services, sourceId: string, staffId: string | null): Promise<string> {
  return enqueue(s.db, 'source.setup', { sourceId }, { createdBy: staffId, maxAttempts: 1 });
}

/** Several sites from a list of links (the CMS form and the agent): each is created and set up automatically. */
export async function addSources(s: Services, staff: { id: string }, urls: string[], region: SourceRegion, defaultCategoryId: number | null = null) {
  const created: { id: string; baseUrl: string }[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const u = new URL(raw);
    u.hash = '';
    const baseUrl = u.toString();
    if (seen.has(baseUrl)) continue;
    seen.add(baseUrl);
    const [dup] = await s.db.select({ id: sources.id }).from(sources).where(eq(sources.baseUrl, baseUrl)).limit(1);
    if (dup) {
      skipped.push({ url: raw, reason: 'כבר קיים ברשימה' });
      continue;
    }
    const [row] = await s.db
      .insert(sources)
      .values({ name: u.hostname.replace(/^www\./, ''), baseUrl, region, defaultCategoryId, requestedBy: staff.id, status: 'pending_dev' })
      .returning({ id: sources.id });
    await queueSourceSetup(s, row!.id, staff.id);
    created.push({ id: row!.id, baseUrl });
  }
  await audit(s.db, { userId: staff.id, entity: 'source', entityId: 'bulk', action: 'request', details: { count: created.length } });
  return { created, skipped };
}

/** Approves every site whose saved trigger passed its test; returns how many. */
export async function approveTestedSources(s: Services, staffId: string): Promise<number> {
  const rows = await s.db
    .update(sources)
    .set({ status: 'active', approvedBy: staffId, approvedAt: new Date(), consecutiveFailures: 0 })
    .where(and(eq(sources.status, 'in_development'), isNotNull(sources.lastTestPassedAt), isNotNull(sources.method), isNotNull(sources.selectorConfig)))
    .returning({ id: sources.id });
  for (const r of rows) await audit(s.db, { userId: staffId, entity: 'source', entityId: r.id, action: 'approve' });
  return rows.length;
}

export async function sourcesBeingSetUp(s: Services): Promise<Set<string>> {
  const rows = await s.db
    .select({ sourceId: sql<string>`${jobs.payload}->>'sourceId'` })
    .from(jobs)
    .where(and(eq(jobs.kind, 'source.setup'), inArray(jobs.status, ['queued', 'running'])));
  return new Set(rows.map((r) => r.sourceId));
}

export async function runSourceSetup(s: Services, job: JobRow) {
  const sourceId = String(job.payload.sourceId);
  const [source] = await s.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) throw new PermanentJobError('source not found');
  if (source.status === 'active') return { skipped: 'already active' };

  const result = await autodetect(s.fetch, source.baseUrl, s.config.scraper.userAgent, source.region);
  const language = result.language && !result.language.startsWith('he') ? result.language : source.region === 'international' ? (source.language ?? null) : null;
  const hostname = new URL(source.baseUrl).hostname.replace(/^www\./, '');
  const name = source.name === hostname && result.name ? result.name.slice(0, 80) : source.name;
  const problems = [...result.notes, ...(result.test?.errors ?? []), ...(result.test?.warnings ?? [])];

  if (!result.config) {
    await s.db
      .update(sources)
      .set({ name, language, devNotes: `הגדרה אוטומטית לא הצליחה: ${problems.join(' ')}`.slice(0, 2000) })
      .where(eq(sources.id, sourceId));
    return { ok: false };
  }

  await s.db
    .update(sources)
    .set({
      name,
      language,
      method: result.config.method,
      listUrls: result.config.listUrls,
      selectorConfig: result.config.selectorConfig,
      status: 'in_development',
      lastTestPassedAt: result.test?.ok ? new Date() : null,
      devNotes: [result.config.devNotes, result.test?.ok ? `הבדיקה עברה: ${result.test.items.length} כתבות ברשימה.` : '', ...problems].filter(Boolean).join(' ').slice(0, 2000),
    })
    .where(eq(sources.id, sourceId));
  return { ok: Boolean(result.test?.ok), items: result.test?.items.length ?? 0 };
}
