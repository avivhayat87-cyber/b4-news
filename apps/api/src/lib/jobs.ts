// A small PostgreSQL-backed job queue (table `jobs`). Workers claim one row at a
// time with FOR UPDATE SKIP LOCKED, so the API process (WORKER=inline) and any
// number of `npm run worker` processes can share the same queue safely.
import { randomUUID } from 'node:crypto';
import { type Db, and, asc, eq, jobs, lt, lte, sql } from '@b4/db';

export type JobRow = typeof jobs.$inferSelect;

/** Throw this from a handler when retrying cannot help (bad input, missing row). */
export class PermanentJobError extends Error {}

export type JobHandler<Ctx> = {
  run(ctx: Ctx, job: JobRow): Promise<unknown>;
  /** Called once when the job has failed for good, to put domain state back in order. */
  onFailed?(ctx: Ctx, job: JobRow, error: Error): Promise<void>;
  maxAttempts?: number;
};

export type Handlers<Ctx> = Record<string, JobHandler<Ctx>>;

type EnqueueOpts = { draftId?: string | null; createdBy?: string | null; runAt?: Date; maxAttempts?: number };

export async function enqueue(db: Db, kind: string, payload: Record<string, unknown>, opts: EnqueueOpts = {}): Promise<string> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind,
      payload,
      draftId: opts.draftId ?? null,
      createdBy: opts.createdBy ?? null,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning({ id: jobs.id });
  return row!.id;
}

type Logger = { info(obj: object, msg?: string): void; error(obj: object, msg?: string): void };

export class JobRunner<Ctx> {
  private readonly workerId = `w-${randomUUID().slice(0, 8)}`;
  private active = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private lastSweep = 0;
  private readonly idle = new Set<() => void>();

  constructor(
    private readonly db: Db,
    private readonly handlers: Handlers<Ctx>,
    private readonly ctx: Ctx,
    private readonly opts: { concurrency: number; pollMs?: number; logger?: Logger },
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  /** Stops claiming new jobs and waits for running ones to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.active > 0) await new Promise<void>((resolve) => this.idle.add(resolve));
  }

  /** Runs due jobs one after another until none are left (tests and scripts). */
  async drain(maxJobs = 100): Promise<number> {
    let done = 0;
    while (done < maxJobs) {
      const job = await this.claim();
      if (!job) break;
      await this.execute(job);
      done++;
    }
    return done;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    try {
      if (Date.now() - this.lastSweep > 60_000) {
        this.lastSweep = Date.now();
        await this.recoverStale();
      }
      let claimed = false;
      while (!this.stopped && this.active < this.opts.concurrency) {
        const job = await this.claim();
        if (!job) break;
        claimed = true;
        this.active++;
        void this.execute(job).finally(() => {
          this.active--;
          if (this.active === 0) for (const resolve of this.idle) resolve();
          this.idle.clear();
          this.schedule(0);
        });
      }
      this.schedule(claimed ? 50 : (this.opts.pollMs ?? 1000));
    } catch (err) {
      this.opts.logger?.error({ err }, 'job runner tick failed');
      this.schedule(5000);
    }
  }

  private async claim(): Promise<JobRow | null> {
    return this.db.transaction(async (tx) => {
      const [next] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, sql`now()`)))
        .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!next) return null;
      const [job] = await tx
        .update(jobs)
        .set({ status: 'running', lockedAt: new Date(), lockedBy: this.workerId, attempts: sql`${jobs.attempts} + 1` })
        .where(eq(jobs.id, next.id))
        .returning();
      return job ?? null;
    });
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = this.handlers[job.kind];
    const started = Date.now();
    try {
      if (!handler) throw new PermanentJobError(`no handler for job kind "${job.kind}"`);
      const result = await handler.run(this.ctx, job);
      await this.db
        .update(jobs)
        .set({ status: 'succeeded', result: (result ?? null) as object | null, finishedAt: new Date(), lockedAt: null, lastError: null })
        .where(eq(jobs.id, job.id));
      this.opts.logger?.info({ job: job.id, kind: job.kind, ms: Date.now() - started }, 'job done');
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const maxAttempts = handler?.maxAttempts ?? job.maxAttempts;
      const retry = !(error instanceof PermanentJobError) && job.attempts < maxAttempts;
      this.opts.logger?.error({ job: job.id, kind: job.kind, attempt: job.attempts, retry, err: error.message }, 'job failed');
      await this.db
        .update(jobs)
        .set(
          retry
            ? { status: 'queued', runAt: new Date(Date.now() + job.attempts * job.attempts * 10_000), lockedAt: null, lastError: error.message.slice(0, 2000) }
            : { status: 'failed', finishedAt: new Date(), lockedAt: null, lastError: error.message.slice(0, 2000) },
        )
        .where(eq(jobs.id, job.id));
      if (!retry && handler?.onFailed) {
        try {
          await handler.onFailed(this.ctx, job, error);
        } catch (err) {
          this.opts.logger?.error({ job: job.id, err }, 'onFailed hook failed');
        }
      }
    }
  }

  /** Jobs whose worker died mid-run go back to the queue (or fail, if out of attempts). */
  private async recoverStale(): Promise<void> {
    const cutoff = new Date(Date.now() - 15 * 60_000);
    await this.db
      .update(jobs)
      .set({ status: 'queued', lockedAt: null, lastError: 'worker stopped while running; retried' })
      .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff), lt(jobs.attempts, jobs.maxAttempts)));
    await this.db
      .update(jobs)
      .set({ status: 'failed', lockedAt: null, finishedAt: new Date(), lastError: 'worker stopped while running' })
      .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff)));
  }
}
