// Background job "source.setup": detect a site's feed, save the trigger, test it.
// Approval stays a deliberate developer/admin click.
import { and, eq, inArray, jobs, sources, sql } from '@b4/db';
import { PermanentJobError, enqueue, type JobRow } from '../../lib/jobs';
import type { Services } from '../context';
import { autodetect } from './autodetect';

export async function queueSourceSetup(s: Services, sourceId: string, staffId: string | null): Promise<string> {
  return enqueue(s.db, 'source.setup', { sourceId }, { createdBy: staffId, maxAttempts: 1 });
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

  const result = await autodetect(s.fetch, source.baseUrl, s.config.scraper.userAgent);
  const hostname = new URL(source.baseUrl).hostname.replace(/^www\./, '');
  const name = source.name === hostname && result.name ? result.name.slice(0, 80) : source.name;
  const problems = [...result.notes, ...(result.test?.errors ?? []), ...(result.test?.warnings ?? [])];

  if (!result.config) {
    await s.db
      .update(sources)
      .set({ name, devNotes: `הגדרה אוטומטית לא הצליחה: ${problems.join(' ')}`.slice(0, 2000) })
      .where(eq(sources.id, sourceId));
    return { ok: false };
  }

  await s.db
    .update(sources)
    .set({
      name,
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
