// The agent team: every agent with its model, its skills in Hebrew and what it cost this month; an
// admin rewrites a skill or brings back an older version, and a release never replaces it; the
// newsroom rules reach every agent that writes.
import { seedReferenceData } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
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
    expect(res.body.agents.map((a: { id: string }) => a.id)).toEqual(['chief', 'reporter', 'rewrite', 'reviewer', 'social', 'visual', 'translator', 'learning']);
    const rewrite = res.body.agents.find((a: { id: string }) => a.id === 'rewrite');
    expect(rewrite.skills.map((x: { key: string }) => x.key)).toEqual(['rewrite.system', 'refine.system']);
    expect(rewrite.usage).toMatchObject({ calls: 0, costUsd: 0, partial: false });
    expect(res.body.rules).toMatchObject({ key: 'newsroom.rules', kind: 'rules', updatedBy: null });
    expect(res.body.fixedRules).toHaveLength(3);
    expect(res.body.month).toMatch(/^\d{4}-\d{2}$/);
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
    const team = (await editor.get('/agents')).body;
    expect(team.agents.find((a: { id: string }) => a.id === 'rewrite').usage.calls).toBe(1);
    expect(team.agents.find((a: { id: string }) => a.id === 'social').usage).toMatchObject({ calls: 1, costUsd: 0, partial: false });
  });
});
