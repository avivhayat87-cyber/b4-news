// Image generation through Google Gemini (Nano Banana) with the Interactions API.
// One image per request, so a batch runs its requests side by side.
import type { ImageAI, ImageShape } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

type ImageBlock = { type?: string; data?: string };
type InteractionResponse = {
  output_image?: { data?: string };
  output_text?: string;
  steps?: { type?: string; content?: ImageBlock[] }[];
  error?: { message?: string };
};

export type ImageSize = '1K' | '2K' | '4K';

export class GeminiImages implements ImageAI {
  readonly provider = 'gemini';
  readonly live = true;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly size: ImageSize = '2K',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async generate(prompt: string, opts: { count: number; shape: ImageShape }): Promise<Buffer[]> {
    const results = await Promise.allSettled(Array.from({ length: opts.count }, () => this.one(prompt, opts.shape)));
    const images = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    // Some of a batch may fail (a rate limit, a refusal); the editor still gets the rest.
    if (images.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    return images;
  }

  private async one(prompt: string, shape: ImageShape): Promise<Buffer> {
    const res = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        // Article images (16:9) match the hero rendition; story images are 9:16.
        response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: shape === 'portrait' ? '9:16' : '16:9', image_size: this.size },
        // Nothing to continue later, so the prompt is not kept on Google's side.
        store: false,
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const body = (await res.json().catch(() => ({}))) as InteractionResponse;
    if (!res.ok) throw new Error(`image generation failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
    // The final image; thinking may add draft images in earlier steps, so fall back to the last one the model output.
    const data =
      body.output_image?.data ??
      (body.steps ?? [])
        .filter((s) => s.type === 'model_output')
        .flatMap((s) => s.content ?? [])
        .filter((c) => c.type === 'image' && c.data)
        .at(-1)?.data;
    if (!data) throw new Error(`image generation returned no image${body.output_text ? `: ${body.output_text.slice(0, 200)}` : ''}`);
    return Buffer.from(data, 'base64');
  }
}
