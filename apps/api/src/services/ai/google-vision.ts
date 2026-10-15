// Reverse image search through Google Cloud Vision's web detection: where an image (a research
// screenshot) already appeared on the web. With the key entered in the CMS, or on the cloud
// server with the server's own identity (billed to the project, no key).
import type { TokenSource } from '../../lib/google-auth';
import type { ImageReference, ImageSearchAI, WebDetection } from './types';

const ANNOTATE = 'https://vision.googleapis.com/v1/images:annotate';
/** Pages and matches asked for per image. */
const MAX_RESULTS = 10;

/** The CMS key, or the cloud server's own identity (its project pays; Vision needs no role beyond the API being on). */
type Auth = { apiKey: string } | { tokens: TokenSource };

/** Page titles come as HTML fragments ("<b>בנק</b> ישראל"). */
const plain = (html: string | undefined) => (html ?? '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();

export class GoogleVision implements ImageSearchAI {
  readonly provider = 'google-vision';
  readonly live = true;

  constructor(
    private readonly auth: Auth,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async webDetect(image: ImageReference): Promise<WebDetection> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if ('apiKey' in this.auth) headers['x-goog-api-key'] = this.auth.apiKey;
    else {
      headers.authorization = `Bearer ${await this.auth.tokens()}`;
    }
    const res = await this.fetchFn(ANNOTATE, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requests: [{ image: { content: image.data.toString('base64') }, features: [{ type: 'WEB_DETECTION', maxResults: MAX_RESULTS }] }] }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      responses?: {
        error?: { message?: string };
        webDetection?: {
          bestGuessLabels?: { label?: string }[];
          pagesWithMatchingImages?: { url?: string; pageTitle?: string }[];
          fullMatchingImages?: unknown[];
          partialMatchingImages?: unknown[];
          visuallySimilarImages?: unknown[];
        };
      }[];
    };
    if (!res.ok) throw new Error(`Google Vision (${res.status}): ${body.error?.message?.slice(0, 200) ?? 'request failed'}`);
    const first = body.responses?.[0];
    if (first?.error) throw new Error(`Google Vision: ${first.error.message?.slice(0, 200)}`);
    const w = first?.webDetection ?? {};
    return {
      bestGuess: (w.bestGuessLabels ?? []).map((l) => l.label ?? '').filter(Boolean),
      pages: (w.pagesWithMatchingImages ?? []).filter((p) => p.url).map((p) => ({ url: p.url!, title: plain(p.pageTitle) })),
      fullMatches: w.fullMatchingImages?.length ?? 0,
      partialMatches: w.partialMatchingImages?.length ?? 0,
      similar: w.visuallySimilarImages?.length ?? 0,
    };
  }
}

/** No key: nothing is searched, and the research says so. */
export class NoImageSearch implements ImageSearchAI {
  readonly provider = 'none';
  readonly live = false;
  async webDetect(): Promise<WebDetection> {
    return { bestGuess: [], pages: [], fullMatches: 0, partialMatches: 0, similar: 0 };
  }
}
