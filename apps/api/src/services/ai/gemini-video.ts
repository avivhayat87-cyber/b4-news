// Video generation through Google Veo (the Gemini API), for reels: the branded
// first frame comes in, a short vertical video comes out. Veo works as a
// long-running operation: start it, poll until it is done, download the file
// (Google keeps it for two days only, so it is downloaded at once).
import type { AiResult, VideoAI, VideoRequest } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_MS = 10_000;
const MAX_WAIT_MS = 8 * 60_000;

type Operation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
};

export class GeminiVideo implements VideoAI {
  readonly provider = 'gemini';
  readonly live = true;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async call<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(url, { ...init, headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json', ...init?.headers }, signal: AbortSignal.timeout(60_000) });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`video generation failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
    return body;
  }

  async generate(req: VideoRequest): Promise<AiResult<{ video: Buffer | null; mimeType: string }>> {
    const started = Date.now();
    let op = await this.call<Operation>(`${BASE}/models/${encodeURIComponent(this.model)}:predictLongRunning`, {
      method: 'POST',
      body: JSON.stringify({
        instances: [{ prompt: req.prompt, image: { inlineData: { mimeType: req.firstFrame.mimeType, data: req.firstFrame.data.toString('base64') } } }],
        parameters: {
          aspectRatio: req.aspectRatio,
          durationSeconds: String(req.durationSeconds),
          resolution: req.resolution,
          // Image-to-video accepts adults only (and never needs to show identifiable people here).
          personGeneration: 'allow_adult',
          numberOfVideos: 1,
        },
      }),
    });
    if (!op.name) throw new Error('video generation did not start');
    while (!op.done) {
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('video generation took too long');
      await this.sleep(POLL_MS);
      op = await this.call<Operation>(`${BASE}/${op.name}`);
    }
    if (op.error) throw new Error(`video generation failed: ${op.error.message ?? 'unknown error'}`);
    const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) {
      const reasons = op.response?.generateVideoResponse?.raiMediaFilteredReasons?.join('; ');
      throw new Error(`video generation returned no video${reasons ? `: ${reasons}` : ''}`);
    }
    const file = await this.fetchFn(uri, { headers: { 'x-goog-api-key': this.apiKey }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!file.ok) throw new Error(`video download failed (${file.status})`);
    const video = Buffer.from(await file.arrayBuffer());
    return {
      data: { video, mimeType: 'video/mp4' },
      usage: { model: this.model, inputTokens: null, outputTokens: null, latencyMs: Date.now() - started },
    };
  }
}
