// Reels on the social page, step by step: the AI writes Hebrew prompts, the editor approves them,
// then the picture, then the video (from the clean picture), and only an approved reel is
// published. Nothing that costs a picture or a video runs without the editor. No call reaches Google or Meta.
import { aiJobs, articles, desc, eq, mediaAssets, socialAccounts } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VideoAI, VideoRequest } from '../src/services/ai/types';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let articleId: number;

/** A video model that "makes" a video, and remembers what it was asked. */
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

const share = async () => (await editor.get(`/social/articles/${articleId}`)).body;
const costly = async () => (await ctx.db.select({ type: aiJobs.type }).from(aiJobs)).filter((j) => j.type === 'social_image' || j.type === 'social_video').length;

beforeAll(async () => {
  ctx = await setup();
  await ctx.seedSources(); // sample social accounts (no tokens)
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  const [latest] = await ctx.db.select({ id: articles.id }).from(articles).orderBy(desc(articles.publishedAt)).limit(1);
  articleId = latest!.id;
});
afterAll(() => ctx.close());

describe('reels', () => {
  it('needs the post text first, and the kit never starts a reel', async () => {
    expect((await editor.post(`/social/articles/${articleId}/reel/prompts`, {})).status).toBe(422);
    await editor.post('/social/generate', { articleIds: [articleId], formats: ['story', 'reel'] });
    await ctx.drain();
    const s = await share();
    expect(s.formats).toEqual(['story', 'reel']);
    expect(s.reel).toMatchObject({ plan: null, videoUrl: null, posterUrl: null, settings: { durationSeconds: 8, resolution: '1080p', motion: 'zoom_in' } });
    expect(s.reel.estimateUsd).toBeCloseTo(0.96);
  });

  it('starts with two Hebrew prompts for the editor, and makes nothing that costs money', async () => {
    expect((await editor.post(`/social/articles/${articleId}/reel/video`)).status).toBe(409); // no picture yet
    expect((await editor.post(`/social/articles/${articleId}/reel/prompts`, {})).status).toBe(202);
    await ctx.drain();
    const { reel } = await share();
    expect(reel.plan).toMatchObject({ stage: 'prompts', approvedAt: null });
    expect(reel.plan.imagePrompt).toMatch(/[א-ת]/);
    expect(reel.plan.videoPrompt).toMatch(/[א-ת]/);
    expect(reel.image).toBeNull();
    expect(await costly()).toBe(0);

    const edited = await editor.put(`/social/articles/${articleId}/reel/prompts`, { imagePrompt: 'נמל תעשייתי בשקיעה, מכולות צבעוניות', videoPrompt: 'המצלמה נעה לאט הצידה, אור שקיעה חם' });
    expect(edited.status).toBe(200);
    expect(edited.body.reel.plan).toMatchObject({ stage: 'prompts', imagePrompt: 'נמל תעשייתי בשקיעה, מכולות צבעוניות' });
  });

  it('makes the picture and its branded cover only when the editor asks, one step at a time', async () => {
    expect((await editor.post(`/social/articles/${articleId}/reel/image`)).status).toBe(202);
    expect((await editor.post(`/social/articles/${articleId}/reel/prompts`, {})).status).toBe(409); // a step is running
    await ctx.drain();
    const { reel } = await share();
    expect(reel.plan.stage).toBe('image');
    expect(reel.image.isAiGenerated).toBe(true);
    expect(reel.posterUrl).toMatch(/reel-poster-\w+\.jpg$/);
    expect(reel.videoUrl).toBeNull();
    const [made] = await ctx.db.select({ promptKey: aiJobs.promptKey }).from(aiJobs).where(eq(aiJobs.type, 'social_image'));
    expect(made!.promptKey).toBe('reel.image');
  });

  it('without a video model the step stays at the picture', async () => {
    await editor.post(`/social/articles/${articleId}/reel/video`);
    await ctx.drain();
    const { reel } = await share();
    expect(reel.plan.stage).toBe('image');
    expect(reel.videoUrl).toBeNull();
    expect(reel.error).toBeNull();
  });

  it('animates the clean picture by the approved prompt, and waits for the video to be approved', async () => {
    const video = new RecordingVideo();
    ctx.app.services.ai = { ...ctx.app.services.ai, video: async () => video };
    const before = await share();
    await editor.put(`/social/articles/${articleId}`, {
      version: before.version,
      template: before.template,
      kicker: before.kicker,
      headline: before.headline,
      hook: before.hook,
      caption: before.caption,
      hashtags: before.hashtags,
      reelSettings: { durationSeconds: 6, resolution: '720p', motion: 'pan', instruction: '' },
    });

    expect((await editor.post(`/social/articles/${articleId}/reel/video`)).status).toBe(202);
    await ctx.drain();
    expect(video.calls).toHaveLength(1);
    const req = video.calls[0]!;
    expect([req.durationSeconds, req.resolution, req.aspectRatio, req.firstFrame.mimeType]).toEqual([6, '720p', '9:16', 'image/jpeg']);
    expect(req.prompt).toContain('formal news reel');
    expect(req.prompt).toContain('no text');
    expect(req.prompt).toContain('drifts slowly');
    expect(req.prompt).toContain('המצלמה נעה לאט הצידה'); // the editor's prompt (the stand-in doesn't translate)
    // The first frame is the clean picture, not the cover with the headline on it.
    const { reel } = await share();
    const [picture] = await ctx.db.select({ key: mediaAssets.storageKey }).from(mediaAssets).where(eq(mediaAssets.id, reel.image.id));
    const clean = await sharp(await ctx.storage.get(picture!.key)).jpeg({ quality: 92 }).toBuffer();
    expect(req.firstFrame.data.equals(clean)).toBe(true);
    expect(reel.plan.stage).toBe('video');
    expect(reel.videoUrl).toMatch(/reel-\w+\.mp4$/);
  });

  it('publishes a reel only after its video is approved', async () => {
    const accounts = await ctx.db.select().from(socialAccounts);
    const telegram = accounts.find((a) => a.platform === 'telegram')!;
    const refused = await editor.post('/social/publish', { articleIds: [articleId], formats: ['reel'], accountIds: [telegram.id] });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toContain('מאושר');

    const approved = await editor.post(`/social/articles/${articleId}/reel/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.reel.plan).toMatchObject({ stage: 'approved', approvedAt: expect.any(String) });

    expect((await editor.post('/social/publish', { articleIds: [articleId], formats: ['reel'], accountIds: [telegram.id] })).status).toBe(202);
    await ctx.drain();
    expect((await share()).posts).toEqual([expect.objectContaining({ platform: 'telegram', format: 'reel', status: 'skipped' })]);
  });

  it('a new picture replaces the old video, which then has to be made and approved again', async () => {
    await editor.post(`/social/articles/${articleId}/reel/image`);
    await ctx.drain();
    const { reel } = await share();
    expect(reel.plan).toMatchObject({ stage: 'image', approvedAt: null });
    expect(reel.videoUrl).toBeNull();
  });
});
