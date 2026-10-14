// Reel videos through Google Veo on Vertex AI (Google Cloud): the counterpart of
// gemini-video.ts, billed to the Google Cloud account (and its credits) and authorized
// by the server's own identity. A long-running operation: start it, poll until it is
// done; the video comes back in the answer itself.
import type { TokenSource } from '../../lib/google-auth';
import type { AiResult, VideoAI, VideoRequest } from './types';
import { type VertexTarget, vertexModelUrl } from './vertex-images';

const POLL_MS = 10_000;
const MAX_WAIT_MS = 8 * 60_000;

type Operation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { videos?: { bytesBase64Encoded?: string; mimeType?: string }[]; raiMediaFilteredReasons?: string[] };
};

export class VertexVideo implements VideoAI {
  readonly provider = 'vertex';
  readonly live = true;

  constructor(
    private readonly target: VertexTarget,
    private readonly token: TokenSource,
    readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(vertexModelUrl(this.target, this.model, method), {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`video generation failed (${res.status}): ${json.error?.message ?? 'unknown error'}`);
    return json;
  }

  async generate(req: VideoRequest): Promise<AiResult<{ video: Buffer | null; mimeType: string }>> {
    const started = Date.now();
    const start = await this.call<Operation>('predictLongRunning', {
      instances: [{ prompt: req.prompt, image: { bytesBase64Encoded: req.firstFrame.data.toString('base64'), mimeType: req.firstFrame.mimeType } }],
      parameters: {
        aspectRatio: req.aspectRatio,
        durationSeconds: req.durationSeconds,
        resolution: req.resolution,
        // Image-to-video accepts adults only (and never needs to show identifiable people here).
        personGeneration: 'allow_adult',
        sampleCount: 1,
      },
    });
    if (!start.name) throw new Error('video generation did not start');
    let op: Operation = start;
    while (!op.done) {
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('video generation took too long');
      await this.sleep(POLL_MS);
      op = await this.call<Operation>('fetchPredictOperation', { operationName: start.name });
    }
    if (op.error) throw new Error(`video generation failed: ${op.error.message ?? 'unknown error'}`);
    const video = op.response?.videos?.[0];
    if (!video?.bytesBase64Encoded) {
      const reasons = op.response?.raiMediaFilteredReasons?.join('; ');
      throw new Error(`video generation returned no video${reasons ? `: ${reasons}` : ''}`);
    }
    return {
      data: { video: Buffer.from(video.bytesBase64Encoded, 'base64'), mimeType: video.mimeType ?? 'video/mp4' },
      usage: { model: this.model, inputTokens: null, outputTokens: null, latencyMs: Date.now() - started },
    };
  }
}
