// Editor tools around the original: one-click rewording of copied passages,
// images that follow the article (and, if asked, the original's photo), quick
// image drafts of which only the chosen one is redrawn at full quality, and
// image batches that say why they failed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiNotConnectedError, fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages, PlaceholderVideo } from '../src/services/ai/fake';
import type { ImageAI, ImageReference, ImageShape, ImageTier } from '../src/services/ai/types';
import { PermanentJobError } from '../src/lib/jobs';
import { imageErrorMessage } from '../src/services/image-brief';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let draftId: string;

/** Draws placeholders and remembers what it was asked for. */
class RecordingImages implements ImageAI {
  readonly provider = 'recording';
  readonly model = 'recording';
  readonly live = true;
  calls: { prompt: string; references: ImageReference[] }[] = [];
  finished: { prompt: string; draft: ImageReference }[] = [];
  failWith: Error | null = null;
  private readonly inner: PlaceholderImages;
  constructor(tier: ImageTier = 'final') {
    this.inner = new PlaceholderImages(tier);
  }
  async generate(prompt: string, opts: { count: number; shape: ImageShape; references?: ImageReference[] }) {
    this.calls.push({ prompt, references: opts.references ?? [] });
    return this.inner.generate(prompt, opts);
  }
  async finish(prompt: string, draft: ImageReference, shape: ImageShape) {
    this.finished.push({ prompt, draft });
    if (this.failWith) throw this.failWith;
    return this.inner.finish(prompt, draft, shape);
  }
}

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  await ctx.seedSources();
  const run = await editor.post('/discovery/runs');
  await ctx.drain();
  const items = (await editor.get(`/discovery/runs/${run.body.runId}`)).body.items;
  const saved = await editor.post('/discovery/save', { itemIds: [items[0].id], mode: 'single' });
  draftId = saved.body.draftIds[0];
  await ctx.drain();
});
afterAll(() => ctx.close());

describe('accepting the copy-check recommendation', () => {
  it('has nothing to reword while the draft is in our own words', async () => {
    const draft = (await editor.get(`/drafts/${draftId}`)).body;
    const text = 'ניסוח עצמאי לגמרי של הכתבה, במילים שלנו ובסדר אחר, כדי שלא יהיה דמיון למקור. '.repeat(3);
    await editor.put(`/drafts/${draftId}/content`, { version: draft.version, title: draft.title, subtitle: '', bodyDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
    const res = await editor.post(`/drafts/${draftId}/rewrite-copied`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('nothing_to_rewrite');
  });

  it('sends the copied passages, in full, to the AI and applies its rewrite to the draft', async () => {
    const draft = (await editor.get(`/drafts/${draftId}`)).body;
    // The editor pasted the original as it is.
    const copied = draft.original.bodyText as string;
    await editor.put(`/drafts/${draftId}/content`, {
      version: draft.version,
      title: draft.title,
      subtitle: '',
      bodyDoc: { type: 'doc', content: copied.split(/\n+/).filter(Boolean).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) },
    });
    expect((await editor.get(`/drafts/${draftId}/similarity`)).body.level).toBe('high');

    const before = (await editor.get(`/drafts/${draftId}`)).body.version;
    const res = await editor.post(`/drafts/${draftId}/rewrite-copied`);
    expect(res.status).toBe(202);
    const [request] = (await editor.get(`/drafts/${draftId}/chat`)).body.slice(-1);
    expect(request.role).toBe('user');
    expect(request.content).toContain('נסח מחדש');
    expect(request.content).not.toContain('…');
    expect(request.content).toContain(copied.split(/\s+/).slice(0, 8).join(' '));

    await ctx.drain();
    expect((await editor.get(`/drafts/${draftId}`)).body.version).toBe(before + 1);
    expect((await editor.get(`/drafts/${draftId}/chat`)).body.at(-1).role).toBe('assistant');
  });
});

describe('images', () => {
  it('describe the article to the image AI, and pass the original photo only when asked', async () => {
    const images = new RecordingImages();
    ctx.app.services.ai = fixedAi(new FakeText(), images);
    const draft = (await editor.get(`/drafts/${draftId}`)).body;

    expect((await editor.post(`/drafts/${draftId}/images`, { prompt: 'A central bank at dawn' })).status).toBe(202);
    await ctx.drain();
    expect(images.calls[0]!.prompt).toContain('A central bank at dawn');
    expect(images.calls[0]!.prompt).toContain(`Headline: ${draft.title}`);
    expect(images.calls[0]!.references).toHaveLength(0);
    expect(images.calls[0]!.prompt).not.toContain('copyright');

    expect((await editor.post(`/drafts/${draftId}/images`, { prompt: 'A central bank at dawn', useSourceImage: true })).status).toBe(202);
    await ctx.drain();
    const withPhoto = images.calls[1]!;
    expect(withPhoto.references).toHaveLength(1);
    expect(withPhoto.references[0]!.mimeType).toBe('image/jpeg');
    expect(withPhoto.references[0]!.data.subarray(0, 2).toString('hex')).toBe('ffd8'); // the sample SVG became a JPEG
    expect(withPhoto.prompt).toContain('copyright');

    const batches = (await editor.get(`/drafts/${draftId}/images`)).body.batches;
    expect(batches[0]).toMatchObject({ status: 'done', error: null, note: null });
    expect(batches[0].images).toHaveLength(3);
  });

  it('draws quick drafts, and redraws only the chosen one at full quality before it can be published', async () => {
    const drafts = new RecordingImages('draft');
    const finals = new RecordingImages('final');
    ctx.app.services.ai = fixedAi(new FakeText(), finals, drafts);
    await editor.post(`/drafts/${draftId}/images`, { prompt: 'A harbor at dawn' });
    await ctx.drain();
    expect(drafts.calls).toHaveLength(1);
    expect(finals.calls).toHaveLength(0);
    const [batch] = (await editor.get(`/drafts/${draftId}/images`)).body.batches;
    expect(batch.images).toHaveLength(3);
    const chosen = batch.images[1];
    expect(chosen.width).toBeLessThan(1600);

    expect((await editor.patch(`/drafts/${draftId}`, { heroMediaId: chosen.id })).status).toBe(204);
    expect((await editor.patch(`/drafts/${draftId}`, { heroMediaId: chosen.id })).status).toBe(204); // a second click doesn't pay twice
    let state = (await editor.get(`/drafts/${draftId}/images`)).body;
    expect(state).toMatchObject({ heroId: chosen.id, chosenId: chosen.id, upgrade: { status: 'working' } });
    const notReady = 'התמונה הראשית עוד בהכנה באיכות מלאה';
    expect((await editor.get(`/drafts/${draftId}/preview`)).body.items[0].problems).toContain(notReady);

    await ctx.drain();
    expect(finals.finished).toHaveLength(1);
    expect(finals.finished[0]!.prompt).toContain('A harbor at dawn');
    expect(finals.finished[0]!.draft.mimeType).toBe('image/jpeg');
    state = (await editor.get(`/drafts/${draftId}/images`)).body;
    expect(state).toMatchObject({ chosenId: chosen.id, upgrade: null });
    expect(state.heroId).not.toBe(chosen.id);
    // The full-quality version is the main image, not one more option.
    expect(state.batches[0].images.map((m: { id: string }) => m.id)).not.toContain(state.heroId);
    expect((await editor.get(`/drafts/${draftId}`)).body.hero).toMatchObject({ id: state.heroId, width: 1600, height: 900 });
    expect((await editor.get(`/drafts/${draftId}/preview`)).body.items[0].problems).not.toContain(notReady);

    // Choosing it again later reuses the full-quality version.
    await editor.patch(`/drafts/${draftId}`, { heroMediaId: null });
    await editor.patch(`/drafts/${draftId}`, { heroMediaId: chosen.id });
    await ctx.drain();
    expect(finals.finished).toHaveLength(1);
    expect((await editor.get(`/drafts/${draftId}`)).body.hero.id).toBe(state.heroId);
  });

  it('keeps the draft as the main image, and says why, when its full-quality version fails', async () => {
    const finals = new RecordingImages('final');
    finals.failWith = new PermanentJobError('image generation failed (429): Rate limit exceeded (limit: 0, Free Tier)');
    ctx.app.services.ai = fixedAi(new FakeText(), finals, new RecordingImages('draft'));
    const option = (await editor.get(`/drafts/${draftId}/images`)).body.batches[0].images[2];
    await editor.patch(`/drafts/${draftId}`, { heroMediaId: option.id });
    await ctx.drain();
    const state = (await editor.get(`/drafts/${draftId}/images`)).body;
    expect(state).toMatchObject({ heroId: option.id, chosenId: option.id, upgrade: { status: 'failed' } });
    expect(state.upgrade.error).toContain('Billing');
  });

  it('shows why a batch failed', async () => {
    ctx.app.services.ai = {
      text: async () => new FakeText(),
      image: async () => {
        throw new AiNotConnectedError('image');
      },
      video: async () => new PlaceholderVideo(),
      // The visual agent runs on the same Gemini key.
      visual: async () => {
        throw new AiNotConnectedError('image');
      },
      status: async () => ({ text: 'fake', image: 'none', live: false }),
    };
    await editor.post(`/drafts/${draftId}/images`, {});
    await ctx.drain();
    const [failed] = (await editor.get(`/drafts/${draftId}/images`)).body.batches;
    expect(failed.status).toBe('failed');
    expect(failed.images).toHaveLength(0);
    expect(failed.error).toContain('לא מחובר');
  });

  it('turns provider errors into something an editor can act on', () => {
    expect(imageErrorMessage('image generation failed (429): Resource exhausted')).toContain('מכסת');
    expect(imageErrorMessage('image generation failed (429): Rate limit exceeded (limit: 0 input tokens per minute on Free Tier).')).toContain('Billing');
    expect(imageErrorMessage('image generation failed (400): API key not valid.')).toContain('המפתח');
    expect(imageErrorMessage('image generation returned no image: blocked')).toContain('לא החזיר תמונה');
    expect(imageErrorMessage('image generation failed (500): Internal')).toBe('יצירת התמונות נכשלה: (500): Internal');
  });
});
