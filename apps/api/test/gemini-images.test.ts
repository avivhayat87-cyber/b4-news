// The Gemini image adapter against a stand-in for Google's Interactions API.
import { describe, expect, it } from 'vitest';
import { GeminiImages } from '../src/services/ai/gemini-images';

const png = (n: number) => Buffer.from(`image-${n}`).toString('base64');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(answer: (call: number) => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, any> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return answer(calls.length);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Gemini images', () => {
  it('asks for one image per request, in the right shape, without storing the prompt', async () => {
    const { fn, calls } = stub((n) => json(200, { output_image: { data: png(n) } }));
    const images = await new GeminiImages('key-123', 'gemini-nano-banana-2.1', '2K', fn).generate('A harbor at dawn', { count: 4, shape: 'landscape' });
    expect(images.map(String).sort()).toEqual(['image-1', 'image-2', 'image-3', 'image-4']);
    expect(calls).toHaveLength(4);
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(calls[0]!.headers['x-goog-api-key']).toBe('key-123');
    expect(calls[0]!.body).toMatchObject({
      model: 'gemini-nano-banana-2.1',
      input: 'A harbor at dawn',
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '2K' },
      store: false,
    });

    const story = stub(() => json(200, { output_image: { data: png(0) } }));
    await new GeminiImages('k', 'm', '1K', story.fn).generate('p', { count: 1, shape: 'portrait' });
    expect(story.calls[0]!.body.response_format).toMatchObject({ aspect_ratio: '9:16', image_size: '1K' });
  });

  it('sends a reference image beside the text when given one', async () => {
    const { fn, calls } = stub(() => json(200, { output_image: { data: png(1) } }));
    const photo = Buffer.from([0xff, 0xd8, 0xff]);
    await new GeminiImages('k', 'm', '2K', fn).generate('Use it as inspiration', { count: 1, shape: 'landscape', references: [{ data: photo, mimeType: 'image/jpeg' }] });
    expect(calls[0]!.body.input).toEqual([
      { type: 'text', text: 'Use it as inspiration' },
      { type: 'image', mime_type: 'image/jpeg', data: photo.toString('base64') },
    ]);
  });

  it('redraws a chosen draft from the draft itself', async () => {
    const { fn, calls } = stub(() => json(200, { output_image: { data: png(1) } }));
    const draft = Buffer.from([0xff, 0xd8, 0xff]);
    const image = await new GeminiImages('k', 'gemini-nano-banana-2.1', '4K', fn).finish('Keep it as it is', { data: draft, mimeType: 'image/jpeg' }, 'landscape');
    expect(String(image)).toBe('image-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      model: 'gemini-nano-banana-2.1',
      input: [
        { type: 'text', text: 'Keep it as it is' },
        { type: 'image', mime_type: 'image/jpeg', data: draft.toString('base64') },
      ],
      response_format: { aspect_ratio: '16:9', image_size: '4K' },
    });
  });

  it('reads the image from the output steps when there is no output_image', async () => {
    const { fn } = stub(() =>
      json(200, {
        steps: [
          { type: 'thought', content: [{ type: 'image', data: png(9) }] },
          { type: 'model_output', content: [{ type: 'text', text: 'here' }, { type: 'image', data: png(1) }] },
        ],
      }),
    );
    const [image] = await new GeminiImages('k', 'm', '2K', fn).generate('p', { count: 1, shape: 'landscape' });
    expect(String(image)).toBe('image-1');
  });

  it('keeps the images that worked when some requests fail', async () => {
    const { fn } = stub((n) => (n === 2 ? json(429, { error: { message: 'Resource exhausted' } }) : json(200, { output_image: { data: png(n) } })));
    const images = await new GeminiImages('k', 'm', '2K', fn).generate('p', { count: 4, shape: 'landscape' });
    expect(images).toHaveLength(3);
  });

  it('explains a failure when no image came back', async () => {
    const refused = stub(() => json(200, { output_text: 'I can’t create that image.' }));
    await expect(new GeminiImages('k', 'm', '2K', refused.fn).generate('p', { count: 2, shape: 'landscape' })).rejects.toThrow(/no image: I can’t create/);
    const badKey = stub(() => json(400, { error: { message: 'API key not valid.' } }));
    await expect(new GeminiImages('k', 'm', '2K', badKey.fn).generate('p', { count: 1, shape: 'landscape' })).rejects.toThrow(/\(400\): API key not valid/);
  });
});
