// Google Veo through the Gemini API, against a stand-in server: start the
// operation, poll until done, download the video; errors come back readable.
import { describe, expect, it } from 'vitest';
import { GeminiVideo } from '../src/services/ai/gemini-video';
import { reelErrorMessage } from '../src/services/social-reel';

const frame = { data: Buffer.from('jpeg'), mimeType: 'image/jpeg' };
const request = { prompt: 'slow push-in', firstFrame: frame, durationSeconds: 8 as const, resolution: '1080p' as const, aspectRatio: '9:16' as const };

function server(steps: ((url: string, init?: RequestInit) => Response)[]) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`unexpected request ${url}`);
    return step(String(url), init);
  }) as typeof fetch;
  return { fetchFn, seen };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Veo video generation', () => {
  it('starts the operation with the frame and settings, polls, and downloads the video', async () => {
    const { fetchFn, seen } = server([
      () => json({ name: 'models/veo/operations/op1' }),
      () => json({ name: 'models/veo/operations/op1', done: false }),
      () => json({ name: 'models/veo/operations/op1', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.test/v.mp4' } }] } } }),
      () => new Response(Buffer.from('mp4-bytes')),
    ]);
    const veo = new GeminiVideo('key', 'veo-3.1-fast-generate-preview', fetchFn, async () => undefined);
    const out = await veo.generate(request);
    expect(out.data.video?.toString()).toBe('mp4-bytes');
    expect(seen[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning');
    const body = JSON.parse(String(seen[0]!.init?.body));
    expect(body.parameters).toEqual({ aspectRatio: '9:16', durationSeconds: '8', resolution: '1080p', personGeneration: 'allow_adult', numberOfVideos: 1 });
    expect(body.instances[0].image.inlineData).toEqual({ mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') });
    expect(seen[1]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo/operations/op1');
    expect((seen[3]!.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('key');
  });

  it('turns Google errors into messages an editor can act on', async () => {
    const { fetchFn } = server([() => json({ error: { message: 'Quota exceeded. limit: 0, free tier' } }, 429)]);
    const veo = new GeminiVideo('key', 'veo-3.1-fast-generate-preview', fetchFn, async () => undefined);
    const err = await veo.generate(request).catch((e: Error) => e.message);
    expect(reelErrorMessage(String(err))).toContain('Billing');
    const filtered = server([
      () => json({ name: 'op2' }),
      () => json({ name: 'op2', done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['blocked'] } } }),
    ]);
    const msg = await new GeminiVideo('key', 'm', filtered.fetchFn, async () => undefined).generate(request).catch((e: Error) => e.message);
    expect(reelErrorMessage(String(msg))).toContain('סינון תוכן');
  });
});
