// The visual agent (Google): it writes the article image's description in Hebrew when the
// editor didn't, with the newsroom's settings and its learned rules; it records what the
// editor chose at publish; and it learns from those cases, looking at the pictures, in one
// call that makes a new active version of its rules. No call reaches Google.
import { DEFAULT_IMAGE_STYLES } from '@b4/shared';
import { aiJobs, eq, visualFeedback } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAi } from '../src/services/ai';
import { FakeText, FakeVisual, PlaceholderImages, PlaceholderVideo } from '../src/services/ai/fake';
import type { ImagePromptRequest, VisualLearnRequest } from '../src/services/ai/types';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let admin: ReturnType<typeof staffClient>;
let draftId: string;

/** The stand-in agent, remembering what it was asked. */
class RecordingVisual extends FakeVisual {
  prompts: ImagePromptRequest[] = [];
  lessons: VisualLearnRequest[] = [];
  override async imagePrompt(req: ImagePromptRequest) {
    this.prompts.push(req);
    return super.imagePrompt(req);
  }
  override async learn(req: VisualLearnRequest) {
    this.lessons.push(req);
    return super.learn(req);
  }
}

class RecordingImages extends PlaceholderImages {
  calls: string[] = [];
  override async generate(prompt: string, opts: Parameters<PlaceholderImages['generate']>[1]) {
    this.calls.push(prompt);
    return super.generate(prompt, opts);
  }
}

const visual = new RecordingVisual();
const drafts = new RecordingImages('draft');
const batches = async () => (await editor.get(`/drafts/${draftId}/images`)).body.batches;

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
  await ctx.seedSources();
  const run = await editor.post('/discovery/runs');
  await ctx.drain();
  const items = (await editor.get(`/discovery/runs/${run.body.runId}`)).body.items;
  draftId = (await editor.post('/discovery/save', { itemIds: [items[0].id], mode: 'single' })).body.draftIds[0];
  await ctx.drain();
  ctx.app.services.ai = fixedAi(new FakeText(), new PlaceholderImages('final'), drafts, new PlaceholderVideo(), visual);
});
afterAll(() => ctx.close());

describe('the visual agent', () => {
  it('describes three different drafts in Hebrew as soon as the article is written, one per style, and picks one', async () => {
    // The AI's first version comes with three image drafts, each from its own description in its own style.
    const [first] = await batches();
    expect(first).toMatchObject({ status: 'done', promptBy: 'agent' });
    expect(first.prompt).toMatch(/[א-ת]/);
    expect(first.images).toHaveLength(3);
    expect(first.variants.map((v: { style: string }) => v.style)).toEqual([...DEFAULT_IMAGE_STYLES]);
    expect(new Set(first.variants.map((v: { prompt: string }) => v.prompt)).size).toBe(3);
    // The agent recommended one, and it became the main image (still a quick draft).
    expect(first.pick).toMatchObject({ mediaId: first.images[0].id });
    expect(first.pick.reason).toMatch(/[א-ת]/);
    expect((await editor.get(`/drafts/${draftId}/images`)).body).toMatchObject({ heroId: first.images[0].id, heroIsDraft: true });
    const jobs = await ctx.db.select({ type: aiJobs.type, promptKey: aiJobs.promptKey }).from(aiJobs);
    expect(jobs).toContainEqual({ type: 'visual_prompt', promptKey: 'visual.image' });
    expect(jobs).toContainEqual({ type: 'visual_prompt', promptKey: 'visual.pick' });
    expect(jobs.some((j) => j.type === 'translate')).toBe(true); // the image model gets it in English

    // "3 new drafts" without touching the description: the agent knows what was tried.
    expect((await editor.post(`/drafts/${draftId}/images`, {})).status).toBe(202);
    await ctx.drain();
    expect(visual.prompts[0]!.tried).toEqual([first.prompt]);
    expect(visual.prompts[0]!.styles).toEqual([...DEFAULT_IMAGE_STYLES]);
    const [second] = await batches();
    expect(second).toMatchObject({ status: 'done', promptBy: 'agent' });
    expect(second.prompt).not.toBe(first.prompt);
    // Each image is drawn from its own description (the stand-in "translation" keeps the words).
    expect(drafts.calls).toHaveLength(3);
    second.variants.forEach((v: { prompt: string }, i: number) => expect(drafts.calls[i]).toContain(v.prompt));
    // The agent's new pick replaces its own earlier one as the main image.
    expect((await editor.get(`/drafts/${draftId}/images`)).body.heroId).toBe(second.pick.mediaId);

    // The editor's own description is used as it is, for all three.
    await editor.post(`/drafts/${draftId}/images`, { prompt: 'נמל בשחר, מנופים ומכולות' });
    await ctx.drain();
    expect(visual.prompts).toHaveLength(1);
    const [own] = await batches();
    expect(own).toMatchObject({ promptBy: 'editor', prompt: 'נמל בשחר, מנופים ומכולות' });
    expect(own.variants.every((v: { prompt: string }) => v.prompt === 'נמל בשחר, מנופים ומכולות')).toBe(true);
  });

  it('never replaces the image the editor chose with its own pick', async () => {
    const [round] = await batches();
    await editor.patch(`/drafts/${draftId}`, { heroMediaId: round.images[2].id });
    await editor.post(`/drafts/${draftId}/images`, {});
    await ctx.drain();
    const state = (await editor.get(`/drafts/${draftId}/images`)).body;
    expect(state.batches[0].pick).not.toBeNull();
    expect(state.heroId).toBe(round.images[2].id);
  });

  it('writes by the newsroom settings and by the rules it learned', async () => {
    expect((await editor.put('/agent/visual-settings', { articleStyle: 'צילום עיתונאי ריאליסטי', avoid: 'גרפים וחיצים', autoLearn: true })).status).toBe(200);
    expect((await editor.put('/agent/visual/rules', { rules: '1. רק מקומות אמיתיים' })).status).toBe(403);
    expect((await admin.put('/agent/visual/rules', { rules: '1. רק מקומות אמיתיים' })).status).toBe(204);
    await editor.post(`/drafts/${draftId}/images`, {});
    await ctx.drain();
    const guidance = visual.prompts.at(-1)!.guidance;
    expect(guidance).toContain('צילום עיתונאי ריאליסטי');
    expect(guidance).toContain('גרפים וחיצים');
    expect(guidance).toContain('רק מקומות אמיתיים');
  });

  it('records which image the editor chose at publish, and learns from it by looking at the pictures', async () => {
    const [round] = await batches();
    const chosen = round.images[1];
    await editor.patch(`/drafts/${draftId}`, { heroMediaId: chosen.id, category: 'israeli-economy' });
    await ctx.drain();
    expect((await editor.post(`/drafts/${draftId}/finalize`)).status).toBe(204);
    await ctx.drain(); // the legal review of the final text
    expect((await editor.post(`/drafts/${draftId}/publish`, { idempotencyKey: 'visual-agent-1' })).status).toBe(202);
    await ctx.drain(); // the full-quality version of the chosen draft, then the site

    const [f] = await ctx.db.select().from(visualFeedback).where(eq(visualFeedback.kind, 'article_image'));
    expect(f).toMatchObject({ status: 'pending', chosenMediaId: chosen.id });
    expect(f!.rejectedMediaIds).toHaveLength(2);
    // The agent recommended the first; the editor chose the second style.
    expect(f!.detail).toMatchObject({ kind: 'article_image', outcome: 'ai', agentPick: 'changed', chosenStyle: DEFAULT_IMAGE_STYLES[1] });
    const rounds = (f!.detail as { rounds: { by: string | null; chosen: boolean }[] }).rounds;
    expect(rounds.map((r) => r.by)).toEqual(['agent', 'agent', 'editor', 'agent', 'agent']);
    expect(rounds.map((r) => r.chosen)).toEqual([false, false, false, false, true]);

    let overview = (await editor.get('/agent/visual')).body;
    expect(overview).toMatchObject({ pending: 1, learned: 0, live: false, learning: false });
    expect(overview.recent[0]).toMatchObject({ kind: 'article_image', status: 'pending' });

    expect((await editor.post('/agent/visual/learn')).status).toBe(202);
    await ctx.drain();
    const lesson = visual.lessons[0]!;
    expect(lesson.cases).toHaveLength(1);
    expect(lesson.cases[0]!.text).toContain('the editor chose an image from this round');
    expect(lesson.cases[0]!.text).toContain('the editor chose another one');
    expect(lesson.cases[0]!.images.map((i) => i.label)).toEqual(['the image the editor chose', 'an option the editor passed over', 'an option the editor passed over']);
    expect(lesson.cases[0]!.images[0]!.image.mimeType).toBe('image/jpeg');
    expect(lesson.currentRules).toBe('1. רק מקומות אמיתיים');

    overview = (await editor.get('/agent/visual')).body;
    expect(overview).toMatchObject({ pending: 0, learned: 1 });
    const [active, manual] = overview.profiles;
    expect(active).toMatchObject({ isActive: true, feedbackCount: 1 });
    expect(active.summary).toMatch(/[א-ת]/);
    expect(manual).toMatchObject({ isActive: false, summary: null });

    // Nothing new to learn from; an admin can restore the older version.
    expect((await editor.post('/agent/visual/learn')).status).toBe(409);
    expect((await admin.post(`/agent/visual/profiles/${manual.id}/activate`)).status).toBe(204);
    expect((await editor.get('/agent/visual')).body.profiles.find((p: { isActive: boolean }) => p.isActive).id).toBe(manual.id);
  });
});
