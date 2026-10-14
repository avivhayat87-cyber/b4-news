// The distribution plan: marking an article's text final makes the social editor decide how it
// goes out (frame, post, story, a reel recommendation) knowing every option; the newsroom changes
// it in a report; publishing sends it out by itself, and an approved reel runs its steps up to the
// video, which goes out once a person approves it. No call reaches an AI provider or a network.
import { articleSharePosts, articleShares, auditLog, eq, jobs, socialPlans } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import type { SocialPlanRequest, VideoAI, VideoRequest } from '../src/services/ai/types';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

/** The stand-in writer, remembering what the social editor was told. */
class RecordingText extends FakeText {
  plans: SocialPlanRequest[] = [];
  override async socialPlan(req: SocialPlanRequest) {
    this.plans.push(req);
    return super.socialPlan(req);
  }
}

/** A video model that "makes" a video. */
class RecordingVideo implements VideoAI {
  readonly provider = 'gemini';
  readonly model = 'veo-3.1-fast-generate-preview';
  readonly live = true;
  calls: VideoRequest[] = [];
  async generate(req: VideoRequest) {
    this.calls.push(req);
    return { data: { video: Buffer.from('not really an mp4'), mimeType: 'video/mp4' }, usage: { model: this.model, inputTokens: null, outputTokens: null, latencyMs: 1 } };
  }
}

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let viewer: ReturnType<typeof staffClient>;
let heroId: string;
const text = new RecordingText();
const video = new RecordingVideo();

const BODY = 'מחירי הדירות עלו ברבעון האחרון בשיעור חד, כך עולה מנתונים רשמיים שפורסמו היום. '.repeat(4);

async function upload(): Promise<string> {
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3366aa' } }).png().toBuffer();
  const boundary = '----b4plan';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/admin/media',
    headers: { cookie: await signInStaff(ctx, 'editor'), origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  return JSON.parse(res.body).id;
}

/** A finished article waiting to be published; its plan is written when the text is marked final. */
async function finalArticle(title: string): Promise<string> {
  const created = await editor.post('/manual/write', { title, subtitle: 'כותרת משנה', body: BODY, category: 'real-estate', heroMediaId: heroId });
  expect(created.status).toBe(201);
  expect((await editor.post(`/drafts/${created.body.draftId}/finalize`)).status).toBe(204);
  return created.body.draftId;
}

const plan = async (draftId: string) => (await editor.get(`/drafts/${draftId}/social-plan`)).body;

async function publish(draftId: string) {
  const started = await editor.post(`/drafts/${draftId}/publish`, { idempotencyKey: `plan-${draftId}` });
  expect(started.status).toBe(202);
  await ctx.drain();
  return (await editor.get(`/publish-jobs/${started.body.publishJobId}`)).body;
}

beforeAll(async () => {
  ctx = await setup();
  await ctx.seedSources(); // sample accounts: Facebook, Instagram, Telegram, WhatsApp (no tokens)
  ctx.app.services.ai = { ...fixedAi(text, new PlaceholderImages()), video: async () => video };
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
  heroId = await upload();
});
afterAll(() => ctx.close());

describe('distribution plan', () => {
  let draftId: string;

  it('is written when the text is marked final, by a social editor that knows every option', async () => {
    draftId = await finalArticle('מחירי הדירות זינקו ברבעון האחרון');
    expect((await plan(draftId)).state).toBe('writing');
    await ctx.drain();

    const p = await plan(draftId);
    expect(p).toMatchObject({ state: 'ready', enabled: true, formats: ['feed', 'story'], aiChoice: { formats: ['feed', 'story'], reel: true } });
    expect(p.headline.length).toBeGreaterThan(5);
    expect(p.reasons.template).toMatch(/[א-ת]/);
    // The AI only recommends a reel: a person approves it, so it isn't in what goes out yet.
    expect(p.reel).toMatchObject({ recommended: true, motion: 'zoom_in', durationSeconds: 8 });
    expect(p.reel.idea).toMatch(/[א-ת]/);
    expect(p.reelEstimateUsd).toBeCloseTo(0.96);
    expect(p.rendered.feed).toMatch(/plan-feed-\w+\.jpg$/);
    expect(p.rendered.story).toMatch(/plan-story-\w+\.jpg$/);

    // The catalog it chose from comes from the code and the accounts.
    const told = text.plans.at(-1)!;
    for (const option of ['headline', 'breaking', 'quote', 'explainer', 'feed', 'story', 'reel', 'zoom_in', 'parallax', 'ערוץ הטלגרם (לדוגמה)']) expect(told.options).toContain(option);
    expect(told.options).toContain('not connected');
    expect(told.guidance).toBe('');
  });

  it('shows in the report and takes quick changes, which only editors can make', async () => {
    const report = (await editor.get('/social/plans')).body;
    expect(report.autoPost).toBe(true);
    expect(report.pending.map((x: { draftId: string }) => x.draftId)).toContain(draftId);

    const p = await plan(draftId);
    expect((await viewer.put(`/drafts/${draftId}/social-plan`, { version: p.version, template: 'quote' })).status).toBe(403);
    const changed = await editor.put(`/drafts/${draftId}/social-plan`, { version: p.version, template: 'quote', formats: ['feed'] });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ template: 'quote', formats: ['feed'], rendered: { story: null } });
    expect(changed.body.rendered.feed).not.toBe(p.rendered.feed);
    expect((await editor.put(`/drafts/${draftId}/social-plan`, { version: p.version, template: 'breaking' })).status).toBe(409);
    const [row] = await ctx.db.select().from(socialPlans).where(eq(socialPlans.draftId, draftId));
    expect(row!.choicesBy).toBe('editor');
  });

  it("keeps the editor's choices when the AI writes again, and learns from them in the next plan", async () => {
    expect((await editor.post(`/drafts/${draftId}/social-plan/regenerate`, { instruction: 'כותרת קצרה יותר' })).status).toBe(202);
    await ctx.drain();
    expect(await plan(draftId)).toMatchObject({ template: 'quote', formats: ['feed'], state: 'ready' });
    expect(text.plans.at(-1)!.instruction).toBe('כותרת קצרה יותר');

    // The next article's plan reads the correction.
    await finalArticle('מחירי הדלק יעלו בחודש הבא');
    await ctx.drain();
    expect(text.plans.at(-1)!.guidance).toContain('they chose frame=quote, feed');
    const overview = (await editor.get('/agent/social')).body;
    expect(overview.corrections[0]).toMatchObject({ draftId, agent: { reel: true }, editor: { template: 'quote', formats: ['feed'], reel: false } });
  });

  it('marks the plan stale when the text is reopened, and writes it again when it is final', async () => {
    expect((await editor.post(`/drafts/${draftId}/reopen`)).status).toBe(204);
    expect((await plan(draftId)).state).toBe('stale');
    expect((await editor.post(`/drafts/${draftId}/finalize`)).status).toBe(204);
    await ctx.drain();
    expect(await plan(draftId)).toMatchObject({ state: 'ready', template: 'quote' });
  });

  it('approves a reel with one click; publishing sends the plan out and runs the reel up to the video', async () => {
    const p = await plan(draftId);
    const approved = await editor.put(`/drafts/${draftId}/social-plan`, { version: p.version, formats: ['feed', 'reel'], reelSeconds: 6 });
    expect(approved.body).toMatchObject({ formats: ['feed', 'reel'], reel: { durationSeconds: 6 } });
    const [audited] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'formats_with_reel'));
    expect(audited!.entityId).toBe(draftId);

    const job = await publish(draftId);
    expect(job.steps[`${draftId}:social`]).toBe('plan: 4 posts, reel started');
    const after = await plan(draftId);
    expect(after.state).toBe('published');
    const articleId = after.articleId as number;

    // The social page has the article's share, from the plan.
    const [share] = await ctx.db.select().from(articleShares).where(eq(articleShares.articleId, articleId));
    expect(share).toMatchObject({ template: 'quote', formats: ['feed', 'reel'], reelSettings: { durationSeconds: 6, motion: 'zoom_in' } });
    // A feed post to every account (prepared by hand: no tokens), no story.
    const posts = await ctx.db.select().from(articleSharePosts).where(eq(articleSharePosts.articleId, articleId));
    expect(posts.map((x) => x.format).sort()).toEqual(['feed', 'feed', 'feed', 'feed']);
    expect(posts.every((x) => x.status === 'skipped')).toBe(true);

    // The reel ran by itself up to the video, which waits for a person; 6 seconds, as planned.
    expect(share!.reelPlan).toMatchObject({ stage: 'video' });
    expect(video.calls.at(-1)!.durationSeconds).toBe(6);
    const report = (await editor.get('/social/plans')).body;
    expect(report.recent.find((x: { draftId: string }) => x.draftId === draftId)).toMatchObject({ state: 'published', reelStage: 'video' });

    // Approving the video sends the reel to the accounts that take reels.
    expect((await editor.post(`/social/articles/${articleId}/reel/approve`)).status).toBe(200);
    await ctx.drain();
    const reels = await ctx.db.select().from(articleSharePosts).where(eq(articleSharePosts.articleId, articleId));
    expect(reels.filter((x) => x.format === 'reel')).toHaveLength(2); // Facebook and Instagram
    expect((await editor.put(`/drafts/${draftId}/social-plan`, { version: after.version, template: 'headline' })).status).toBe(409);
  });

  it('keeps an article off the networks when its plan is turned off', async () => {
    const id = await finalArticle('דוח חדש על שוק הדיור');
    await ctx.drain();
    const p = await plan(id);
    expect((await editor.put(`/drafts/${id}/social-plan`, { version: p.version, enabled: false })).body.state).toBe('off');
    const job = await publish(id);
    expect(job.steps[`${id}:social`]).toBe('plan: kept on the social page');
    const { articleId } = await plan(id);
    expect(await ctx.db.select().from(articleSharePosts).where(eq(articleSharePosts.articleId, articleId))).toHaveLength(0);
    expect(await ctx.db.select().from(articleShares).where(eq(articleShares.articleId, articleId))).toHaveLength(1);
  });

  it('writes no plan when the newsroom turned automatic plans off', async () => {
    const settings = (await editor.get('/agent/social')).body.settings;
    expect((await viewer.put('/agent/social-settings', { ...settings, autoPlan: false })).status).toBe(403);
    expect((await editor.put('/agent/social-settings', { ...settings, autoPlan: false, instructions: 'בלי סטורי בסופי שבוע' })).status).toBe(200);
    const before = (await ctx.db.select().from(jobs).where(eq(jobs.kind, 'social.plan'))).length;
    const id = await finalArticle('כתבה בלי תוכנית אוטומטית');
    expect((await ctx.db.select().from(jobs).where(eq(jobs.kind, 'social.plan'))).length).toBe(before);
    expect((await plan(id)).state).toBe('none');
    // It can still be asked for, and then it reads the newsroom's instructions.
    expect((await editor.post(`/drafts/${id}/social-plan/regenerate`, {})).status).toBe(202);
    await ctx.drain();
    expect((await plan(id)).state).toBe('ready');
    expect(text.plans.at(-1)!.guidance).toContain('בלי סטורי בסופי שבוע');
  });
});
