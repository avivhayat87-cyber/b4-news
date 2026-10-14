// Images and reels through Vertex AI (Google Cloud) against stand-ins for Vertex and
// the metadata server: the server's own token, the right model addresses, and the
// image or video read from the answer. On the cloud server they replace the API key.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { metadataTokens } from '../src/lib/google-auth';
import { createAiHub } from '../src/services/ai';
import { VertexImages, vertexModelUrl } from '../src/services/ai/vertex-images';
import { VertexVideo } from '../src/services/ai/vertex-video';
import type { SettingsStore } from '../src/services/settings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const b64 = (s: string) => Buffer.from(s).toString('base64');
const target = { project: 'b4-news-prod', location: 'global' };

function stub(answer: (url: string, body: any, n: number) => Response) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    return answer(url, body, calls.length);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Vertex AI', () => {
  it('addresses models globally or by region', () => {
    expect(vertexModelUrl(target, 'gemini-3.1-flash-image', 'generateContent')).toBe(
      'https://aiplatform.googleapis.com/v1/projects/b4-news-prod/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent',
    );
    expect(vertexModelUrl({ project: 'p-12345', location: 'us-central1' }, 'veo-3.1-lite-generate-001', 'predictLongRunning')).toMatch(/^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/p-12345\/locations\/us-central1\//);
  });

  it('draws images with the server’s token, in the shape asked for, from the drafts it is given', async () => {
    const { fn, calls } = stub((_u, _b, n) => json({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: b64(`image-${n}`) } }] } }] }));
    const images = await new VertexImages(target, async () => 'tok', 'gemini-3.1-flash-image', '1K', fn).generate('A harbor at dawn', { count: 3, shape: 'landscape' });
    expect(images.map(String).sort()).toEqual(['image-1', 'image-2', 'image-3']);
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.body.generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } });

    const draft = Buffer.from([0xff, 0xd8, 0xff]);
    await new VertexImages(target, async () => 'tok', 'm', '2K', fn).finish('Keep it as it is', { data: draft, mimeType: 'image/jpeg' }, 'portrait');
    const finish = calls.at(-1)!.body;
    expect(finish.contents[0].parts).toEqual([{ text: 'Keep it as it is' }, { inlineData: { mimeType: 'image/jpeg', data: draft.toString('base64') } }]);
    expect(finish.generationConfig.imageConfig.aspectRatio).toBe('9:16');
  });

  it('explains a refusal or an error the way the editor messages expect', async () => {
    const refused = stub(() => json({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(new VertexImages(target, async () => 't', 'm', '2K', refused.fn).generate('p', { count: 1, shape: 'landscape' })).rejects.toThrow('image generation returned no image: SAFETY');
    const quota = stub(() => json({ error: { message: 'Quota exceeded' } }, 429));
    await expect(new VertexImages(target, async () => 't', 'm', '2K', quota.fn).generate('p', { count: 1, shape: 'landscape' })).rejects.toThrow('image generation failed (429): Quota exceeded');
  });

  it('makes a reel: starts the operation, polls it, and reads the video from the answer', async () => {
    const { fn, calls } = stub((url, _b, n) =>
      url.endsWith(':predictLongRunning') ? json({ name: 'projects/p/locations/us-central1/publishers/google/models/veo/operations/op1' }) : json(n < 3 ? { done: false } : { done: true, response: { videos: [{ bytesBase64Encoded: b64('mp4'), mimeType: 'video/mp4' }] } }),
    );
    const naps: number[] = [];
    const video = new VertexVideo({ project: 'b4-news-prod', location: 'us-central1' }, async () => 'tok', 'veo-3.1-lite-generate-001', fn, async (ms) => void naps.push(ms));
    const made = await video.generate({ prompt: 'Slow push in', firstFrame: { data: Buffer.from('jpg'), mimeType: 'image/jpeg' }, durationSeconds: 8, resolution: '720p', aspectRatio: '9:16' });
    expect(String(made.data.video)).toBe('mp4');
    expect(calls[0]!.body).toMatchObject({ instances: [{ prompt: 'Slow push in', image: { bytesBase64Encoded: b64('jpg'), mimeType: 'image/jpeg' } }], parameters: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', sampleCount: 1 } });
    expect(calls[1]!.url).toMatch(/:fetchPredictOperation$/);
    expect(calls[1]!.body).toEqual({ operationName: 'projects/p/locations/us-central1/publishers/google/models/veo/operations/op1' });
    expect(naps).toHaveLength(2);
  });

  it('takes the server’s token from the metadata server, once until it nearly expires', async () => {
    const { fn, calls } = stub(() => json({ access_token: 'ya29.token', expires_in: 3600 }));
    const tokens = metadataTokens(fn);
    expect(await tokens()).toBe('ya29.token');
    expect(await tokens()).toBe('ya29.token');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['Metadata-Flavor']).toBe('Google');
    const away = metadataTokens((async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch);
    await expect(away()).rejects.toThrow(/no Google Cloud identity/);
  });

  it('is chosen over the API key when VERTEX_PROJECT is set, with the models from the CMS', async () => {
    const config = loadConfig({ NODE_ENV: 'test', IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'key', VERTEX_PROJECT: 'b4-news-prod' } as NodeJS.ProcessEnv);
    const settings = { integration: async () => ({ apiKey: 'key', previewModel: 'gemini-3.1-flash-image', imageModel: 'gemini-3-pro-image', imageSize: '2K', videoModel: 'veo-3.1-lite-generate-001', source: 'env' }) } as unknown as SettingsStore;
    const hub = createAiHub(config, settings, async () => 'tok');
    expect(await hub.image('draft')).toMatchObject({ provider: 'vertex', model: 'gemini-3.1-flash-image' });
    expect(await hub.image()).toMatchObject({ provider: 'vertex', model: 'gemini-3-pro-image' });
    expect(await hub.video()).toMatchObject({ provider: 'vertex', model: 'veo-3.1-lite-generate-001' });
    const withoutVertex = createAiHub(loadConfig({ NODE_ENV: 'test', IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'key' } as NodeJS.ProcessEnv), settings, async () => 'tok');
    expect((await withoutVertex.image()).provider).toBe('gemini');
  });
});
