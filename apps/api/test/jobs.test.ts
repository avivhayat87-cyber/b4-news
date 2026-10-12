// The job queue after a restart: work a stopped process left "running" is picked up again.
import { createDb, eq, jobs } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRunner, enqueue } from '../src/lib/jobs';

const handle = createDb('memory:');
beforeAll(() => handle.migrate());
afterAll(() => handle.close());

describe('job runner', () => {
  it('retries the jobs a restart cut off, or fails those out of attempts', async () => {
    const retried = await enqueue(handle.db, 'demo', {}, { maxAttempts: 3 });
    const lastTry = await enqueue(handle.db, 'demo', {}, { maxAttempts: 1 });
    // What a process killed mid-run leaves behind.
    await handle.db.update(jobs).set({ status: 'running', lockedAt: new Date(), lockedBy: 'w-gone', attempts: 1 });

    let ran = 0;
    const gaveUp: string[] = [];
    const runner = new JobRunner(handle.db, { demo: { run: async () => void ran++, onFailed: async (_ctx, job) => void gaveUp.push(job.id) } }, {}, { concurrency: 1 });
    expect(await runner.drain()).toBe(0); // still "running": nothing to claim
    await runner.recoverInterrupted();

    const status = async (id: string) => (await handle.db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, id)))[0]!.s;
    expect(await status(lastTry)).toBe('failed');
    expect(gaveUp).toEqual([lastTry]); // its domain state is told (e.g. a discovery run gets closed)
    expect(await status(retried)).toBe('queued');
    expect(await runner.drain()).toBe(1);
    expect(ran).toBe(1);
    expect(await status(retried)).toBe('succeeded');
  });
});
