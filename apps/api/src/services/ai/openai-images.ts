// Image generation through the OpenAI Images API (model set by IMAGE_MODEL).
import type { ImageAI, ImageShape } from './types';

type ImagesResponse = { data?: { b64_json?: string }[]; error?: { message?: string } };

export class OpenAiImages implements ImageAI {
  readonly provider = 'openai';
  readonly live = true;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(prompt: string, opts: { count: number; shape: ImageShape }): Promise<Buffer[]> {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: opts.count,
        size: opts.shape === 'portrait' ? '1024x1536' : '1536x1024',
        quality: 'medium',
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const body = (await res.json().catch(() => ({}))) as ImagesResponse;
    if (!res.ok) throw new Error(`image generation failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
    const images = (body.data ?? []).flatMap((d) => (d.b64_json ? [Buffer.from(d.b64_json, 'base64')] : []));
    if (images.length === 0) throw new Error('image generation returned no images');
    return images;
  }
}
