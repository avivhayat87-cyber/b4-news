// The agent team: every agent with its model, its skills in Hebrew and what it cost in a period; an
// admin rewrites a skill or brings back an older version, and a release never replaces it; the
// newsroom rules reach every agent that writes.
import { aiJobs, seedReferenceData } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { israelMidnight, usageRange } from '../src/services/agent/team';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import { imageCostUsd } from '../src/services/ai/prices';
import type { RefineRequest, SocialPlanRequest } from '../src/services/ai/types';
import { setup, signInStaff, staffClient } from './helpers';

/** The stand-in writer, remembering the instructions it was given. */
class RecordingText extends FakeText {
  systems: string[] = [];
  override async refine(req: RefineRequest) {
    this.systems.push(req.systemPrompt);
    return super.refine(req);
  }
  override async socialPlan(req: SocialPlanRequest) {
    this.systems.push(req.systemPrompt);
    return super.socialPlan(req);
  }
}

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: ReturnType<typeof staffClient>;
let editor: ReturnType<typeof staffClient>;
const text = new RecordingText();

beforeAll(async () => {
  ctx = await setup();
  ctx.app.services.ai = fixedAi(text, new PlaceholderImages());
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
});
afterAll(() => ctx.close());

const skill = async (key: string) => (await editor.get(`/skills/${key}`)).body;
const active = (s: { versions: { isActive: boolean; body: string; version: number; createdBy: string | null }[] }) => s.versions.find((v) => v.isActive)!;

describe('agent team', () => {
  it('shows every agent with its model and skills, the newsroom rules and the fixed ones', async () => {
    const res = await editor.get('/agents');
    expect(res.status).toBe(200);
    expect(res.body.agents.map((a: { id: string }) => a.id)).toEqual(['chief', 'reporter', 'rewrite', 'reviewer', 'social', 'visual', 'translator', 'learning', 'ads']);
    const rewrite = res.body.agents.find((a: { id: string }) => a.id === 'rewrite');
    expect(rewrite.skills.map((x: { key: string }) => x.key)).toEqual(['rewrite.system', 'rewrite.combine', 'refine.system']);
    const chief = res.body.agents.find((a: { id: string }) => a.id === 'chief');
    expect(chief.skills.map((x: { key: string }) => x.key)).toEqual(['agent.system', 'meeting.pitch', 'discovery.pick', 'desk.plan']);
    expect(res.body.rules).toMatchObject({ key: 'newsroom.rules', kind: 'rules', updatedBy: null });
    expect(res.body.fixedRules).toHaveLength(3);
    const usage = (await editor.get('/agents/usage')).body;
    expect(usage).toMatchObject({ period: 'month', to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), total: { calls: 0, costUsd: 0, partial: false } });
    expect(usage.from).toBe(`${usage.to.slice(0, 7)}-01`);
  });

  it('writes the skills in Hebrew, keeps the English ones in their history, and the model templates in English', async () => {
    const team = (await editor.get('/agents')).body;
    for (const agent of team.agents) {
      for (const s of agent.skills) {
        const body = active(await skill(s.key)).body;
        if (s.kind === 'template') expect(body).not.toMatch(/[א-ת]{4}/);
        else expect(body).toMatch(/[א-ת]{4}/);
      }
    }
    const rewrite = await skill('rewrite.system');
    expect(rewrite.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(rewrite.versions[1].body).toContain('Act as an external news reporter');
    expect(rewrite.placeholders).toEqual(['{{style_rules}}']);
  });

  it('lets only an admin rewrite a skill; the new version is in use at once, and a release keeps it', async () => {
    const body = 'אתה עורך הרשתות של B4 NEWS. כתוב טקסט קצר וחד לפוסט ולסטורי, עם שאלה אחת בסוף.';
    expect((await editor.put('/skills/social.kit', { body })).status).toBe(403);
    const saved = await admin.put('/skills/social.kit', { body });
    expect(saved.status).toBe(200);
    expect(active(saved.body)).toMatchObject({ body, createdBy: 'Test admin' });
    // The next release seeds the defaults again: the admin's wording stays in use.
    await seedReferenceData(ctx.db);
    expect(active(await skill('social.kit')).body).toBe(body);
    expect((await admin.put('/skills/rewrite.system', { body: 'כתוב מחדש את הכתבה בסגנון שלנו, בלי מקום לכללים שנלמדו.' })).status).toBe(422);
    expect((await admin.put('/skills/no.such', { body })).status).toBe(404);
  });

  it('brings back an older version as a new one, under the admin', async () => {
    const before = await skill('social.kit');
    const english = before.versions.find((v: { body: string }) => v.body.startsWith('You are the social media editor'));
    const restored = await admin.post(`/skills/social.kit/versions/${english.version}/restore`);
    expect(restored.status).toBe(200);
    expect(active(restored.body)).toMatchObject({ body: english.body, createdBy: 'Test admin' });
    expect(active(restored.body).version).toBe(before.versions[0].version + 1);
    await seedReferenceData(ctx.db);
    expect(active(await skill('social.kit')).body).toBe(english.body);
  });

  it('gives every writing agent the newsroom rules after its own skill, as the newsroom edits them', async () => {
    const rules = '- כל מספר מגיע עם המקור שלו.\n- בלי סופרלטיבים בכותרות.';
    expect((await admin.put('/skills/newsroom.rules', { body: rules })).status).toBe(200);
    const created = await editor.post('/manual/write', { title: 'בדיקה של נהלי המערכת', body: 'פסקה ראשונה של הכתבה, ארוכה מספיק כדי לעבור את הבדיקה של הטקסט הסופי. '.repeat(3), category: 'israeli-economy' });
    const draftId = created.body.draftId;
    expect((await editor.post(`/drafts/${draftId}/refine`, { instruction: 'תקצר' })).status).toBe(202);
    await ctx.drain();
    expect((await editor.post(`/drafts/${draftId}/finalize`)).status).toBe(204);
    await ctx.drain();
    const [refine, plan] = text.systems.slice(-2);
    expect(refine).toContain('אתה שותף הכתיבה');
    for (const system of [refine, plan]) expect(system).toContain(`נהלי המערכת (חלים על כל הסוכנים):\n${rules}`);

    // What they did this month, per agent (the stand-in costs nothing).
    const usage = (await editor.get('/agents/usage?period=month')).body;
    expect(usageOf(usage, 'rewrite').calls).toBe(1);
    expect(usageOf(usage, 'social')).toMatchObject({ calls: 1, costUsd: 0, partial: false });
  });
});

type Report = { agents: { id: string; usage: { calls: number; costUsd: number; partial: boolean } }[]; total: { calls: number; costUsd: number; partial: boolean } };
const usageOf = (report: Report, id: string) => report.agents.find((a) => a.id === id)!.usage;

describe('what the agents cost', () => {
  const at = (iso: string) => new Date(iso);
  /** One AI call as ai_jobs keeps it. */
  const job = (type: (typeof aiJobs.$inferInsert)['type'], model: string, createdAt: Date, more: Partial<typeof aiJobs.$inferInsert> = {}) =>
    ctx.db.insert(aiJobs).values({ type, provider: 'test', model, status: 'succeeded', createdAt, ...more });

  it('counts the days by Israel time, summer and winter', () => {
    // 01:30 in Israel on Oct 15 (summer time, UTC+3) is still Oct 14 in UTC.
    expect(usageRange({ period: 'day' }, at('2026-10-14T22:30:00Z'))).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(usageRange({ period: 'month' }, at('2026-10-14T22:30:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(usageRange({ period: 'year' }, at('2026-10-14T22:30:00Z'))).toEqual({ from: '2026-01-01', to: '2026-10-15' });
    expect(usageRange({ period: 'all' }, at('2026-10-14T22:30:00Z'))).toEqual({ from: null, to: '2026-10-15' });
    expect(israelMidnight('2026-10-15').toISOString()).toBe('2026-10-14T21:00:00.000Z');
    expect(israelMidnight('2026-12-01').toISOString()).toBe('2026-11-30T22:00:00.000Z');
  });

  it("shows each agent's cost since the start, today, this month, this year or between two days", async () => {
    const now = new Date();
    const before = (await editor.get('/agents/usage?period=all')).body as Report;
    // Today: the chief editor on Opus (a million tokens in: $4), and 3 image drafts at their price.
    await job('agent_turn', 'claude-opus-5-5', now, { inputTokens: 1_000_000, outputTokens: 0 });
    await job('article_images', 'gemini-3.1-flash-lite-image', now, { imageCount: 3, costUsd: '0.1008' });
    // Long ago: a rewrite on Sonnet ($0.20), an image from before prices were kept, and a call that failed.
    await job('rewrite', 'claude-sonnet-5-5', at('2025-06-15T09:00:00Z'), { inputTokens: 100_000, outputTokens: 0 });
    await job('article_images', 'gemini-nano-banana-2.1', at('2025-06-16T09:00:00Z'), { imageCount: 1 });
    await job('agent_turn', 'claude-opus-5-5', at('2025-06-17T09:00:00Z'), { status: 'failed', inputTokens: 1_000_000 });

    // Everything the earlier tests ran happened today, so it is in every one of these periods too.
    for (const period of ['day', 'month', 'year']) {
      const r = (await editor.get(`/agents/usage?period=${period}`)).body as Report;
      expect(usageOf(r, 'chief').calls - usageOf(before, 'chief').calls).toBe(1);
      expect(usageOf(r, 'chief').costUsd - usageOf(before, 'chief').costUsd).toBeCloseTo(4);
      expect(usageOf(r, 'visual').calls - usageOf(before, 'visual').calls).toBe(1);
      expect(usageOf(r, 'visual').costUsd - usageOf(before, 'visual').costUsd).toBeCloseTo(0.1008);
      expect(r.total.partial).toBe(false);
    }

    const all = (await editor.get('/agents/usage?period=all')).body as Report;
    expect(all.total.calls - before.total.calls).toBe(4);
    expect(all.total.costUsd - before.total.costUsd).toBeCloseTo(4.3008);
    // The old image has no known price: it is counted, and the cost says it is not complete.
    expect(usageOf(all, 'visual')).toMatchObject({ calls: usageOf(before, 'visual').calls + 2, partial: true });
    expect(all.total.partial).toBe(true);

    const june = (await editor.get('/agents/usage?period=custom&from=2025-06-01&to=2025-06-15')).body as Report;
    expect(june).toMatchObject({ period: 'custom', from: '2025-06-01', to: '2025-06-15', total: { calls: 1, costUsd: 0.2, partial: false } });
    expect(usageOf(june, 'rewrite')).toMatchObject({ calls: 1, costUsd: 0.2 });

    expect((await editor.get('/agents/usage?period=custom&from=2025-06-15&to=2025-06-01')).status).toBe(400);
    expect((await editor.get('/agents/usage?period=custom&from=2025-06-01')).status).toBe(400);
    expect((await editor.get('/agents/usage?period=custom&from=2025-02-30&to=2025-03-01')).status).toBe(400);
    expect((await editor.get('/agents/usage?period=week')).status).toBe(400);
  });

  it('prices images by model and size, and the stand-in at nothing', () => {
    expect(imageCostUsd({ model: 'gemini-3.1-flash-lite-image', size: '1K', live: true }, 3)).toBeCloseTo(0.1008);
    expect(imageCostUsd({ model: 'gemini-nano-banana-2.1', size: '2K', live: true }, 1)).toBe(0.0504);
    expect(imageCostUsd({ model: 'gemini-nano-banana-2.1', size: '4K', live: true }, 1)).toBe(0.113);
    expect(imageCostUsd({ model: 'placeholder', live: false }, 3)).toBeNull();
    expect(imageCostUsd({ model: 'some-new-model', size: '2K', live: true }, 1)).toBeNull();
  });
});
