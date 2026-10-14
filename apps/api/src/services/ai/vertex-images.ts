// Image generation through Gemini on Vertex AI (Google Cloud): the image models of
// gemini-images.ts, billed to the Google Cloud account (and its credits) and authorized
// by the server's own identity instead of an API key. One image per request.
import type { TokenSource } from '../../lib/google-auth';
import type { ImageSize } from './gemini-images';
import type { ImageAI, ImageReference, ImageShape } from './types';

/** Where Vertex AI requests go: the Google Cloud project and region ("global" for the image models). */
export type VertexTarget = { project: string; location: string };

/** A Google model's method on Vertex AI, e.g. generateContent or predictLongRunning. */
export function vertexModelUrl(target: VertexTarget, model: string, method: string): string {
  const host = target.location === 'global' ? 'aiplatform.googleapis.com' : `${target.location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(target.project)}/locations/${target.location}/publishers/google/models/${encodeURIComponent(model)}:${method}`;
}

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string } };
type GenerateResponse = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

export class VertexImages implements ImageAI {
  readonly provider = 'vertex';
  readonly live = true;

  constructor(
    private readonly target: VertexTarget,
    private readonly token: TokenSource,
    readonly model: string,
    private readonly size: ImageSize = '2K',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async generate(prompt: string, opts: { count: number; shape: ImageShape; references?: ImageReference[] }): Promise<Buffer[]> {
    const results = await Promise.allSettled(Array.from({ length: opts.count }, () => this.one(prompt, opts.shape, opts.references ?? [])));
    const images = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    // Some of a batch may fail (a rate limit, a refusal); the editor still gets the rest.
    if (images.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    return images;
  }

  finish(prompt: string, draft: ImageReference, shape: ImageShape): Promise<Buffer> {
    return this.one(prompt, shape, [draft]);
  }

  private async one(prompt: string, shape: ImageShape, references: ImageReference[]): Promise<Buffer> {
    const res = await this.fetchFn(vertexModelUrl(this.target, this.model, 'generateContent'), {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, ...references.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data.toString('base64') } }))] }],
        // Article images (16:9) match the hero rendition; story images are 9:16.
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: shape === 'portrait' ? '9:16' : '16:9', imageSize: this.size } },
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const body = (await res.json().catch(() => ({}))) as GenerateResponse;
    // Same wording as gemini-images.ts, so imageErrorMessage explains both to the editor.
    if (!res.ok) throw new Error(`image generation failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    // Thinking may add draft images first; the last image is the final one.
    const data = parts.filter((p) => p.inlineData?.data).at(-1)?.inlineData?.data;
    if (!data) {
      const why = body.promptFeedback?.blockReason ?? parts.find((p) => p.text)?.text?.slice(0, 200) ?? body.candidates?.[0]?.finishReason;
      throw new Error(`image generation returned no image${why ? `: ${why}` : ''}`);
    }
    return Buffer.from(data, 'base64');
  }
}
