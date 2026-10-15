import { type Db, aiJobs, and, desc, eq, promptTemplates, styleProfiles } from '@b4/db';
import type { Config } from '../../config';
import { type TokenSource, metadataTokens } from '../../lib/google-auth';
import { PermanentJobError } from '../../lib/jobs';
import type { SettingsStore } from '../settings';
import { AnthropicText } from './anthropic';
import { FakeText, FakeVisual, PlaceholderImages, PlaceholderVideo } from './fake';
import { GeminiImages, type ImageSize } from './gemini-images';
import { GeminiVideo } from './gemini-video';
import { GeminiVisual } from './gemini-visual';
import { GoogleVision, NoImageSearch } from './google-vision';
import type { ImageAI, ImageSearchAI, ImageTier, TextAI, Usage, VideoAI, VisualAI } from './types';
import { VertexImages } from './vertex-images';
import { VertexVideo } from './vertex-video';

/** Drafts are drawn at the lowest resolution every image model supports. */
const DRAFT_SIZE: ImageSize = '1K';

/** Resolves the AI providers per call, so a key entered in the CMS takes effect immediately. */
export interface AiHub {
  text(): Promise<TextAI>;
  /** final (default): full quality; draft: the quick, cheap options the editor chooses from. */
  image(tier?: ImageTier): Promise<ImageAI>;
  /** Reel videos (Google Veo); model overrides the one set in Settings. */
  video(model?: string): Promise<VideoAI>;
  /** The visual agent (Google Gemini): the prompts for article images and reels, and its learning. */
  visual(): Promise<VisualAI>;
  /** Reverse image search (Google Vision); the stand-in when it isn't connected. */
  imageSearch(): Promise<ImageSearchAI>;
  status(): Promise<{ text: string; image: string; live: boolean }>;
}

export class AiNotConnectedError extends PermanentJobError {
  constructor(what: 'text' | 'image') {
    super(
      what === 'text'
        ? 'ה-AI לכתיבה לא מחובר. מנהל/ת יכול/ה לחבר את Claude ב"הגדרות" > "חיבורים".'
        : 'ה-AI לתמונות לא מחובר. מנהל/ת יכול/ה לחבר את Gemini ב"הגדרות" > "חיבורים".',
    );
  }
}

/** Fixed providers (tests). */
export function fixedAi(
  text: TextAI,
  image: ImageAI,
  draftImage: ImageAI = image,
  video: VideoAI = new PlaceholderVideo(),
  visual: VisualAI = new FakeVisual(),
  imageSearch: ImageSearchAI = new NoImageSearch(),
): AiHub {
  return {
    imageSearch: async () => imageSearch,
    text: async () => text,
    image: async (tier = 'final') => (tier === 'draft' ? draftImage : image),
    video: async () => video,
    visual: async () => visual,
    status: async () => ({ text: text.provider, image: image.provider, live: text.live && image.live }),
  };
}

export function createAiHub(config: Config, settings: SettingsStore, tokens: TokenSource = metadataTokens()): AiHub {
  const fakeText = new FakeText();
  const vertex = config.ai.vertex;
  const placeholders: Record<ImageTier, ImageAI> = { draft: new PlaceholderImages('draft'), final: new PlaceholderImages('final') };
  let textCache: { key: string; ai: TextAI } | null = null;
  const imageCache = new Map<ImageTier, { key: string; ai: ImageAI }>();

  const text = async (): Promise<TextAI> => {
    if (config.ai.text === 'fake') return fakeText;
    const v = await settings.integration('anthropic');
    if (v.apiKey) {
      const key = `${v.apiKey}|${v.model}|${v.modelFast}`;
      if (textCache?.key !== key) textCache = { key, ai: new AnthropicText(v.apiKey, v.model!, v.modelFast!) };
      return textCache.ai;
    }
    if (config.ai.allowStandIns) return fakeText;
    throw new AiNotConnectedError('text');
  };

  const image = async (tier: ImageTier = 'final'): Promise<ImageAI> => {
    if (config.ai.image === 'placeholder') return placeholders[tier];
    const v = await settings.integration('gemini');
    if (vertex || v.apiKey) {
      const [model, size] = tier === 'draft' ? [v.previewModel!, DRAFT_SIZE] : [v.imageModel!, v.imageSize as ImageSize];
      const key = `${vertex ? `vertex:${vertex.project}` : v.apiKey}|${model}|${size}`;
      let hit = imageCache.get(tier);
      if (hit?.key !== key) {
        const ai = vertex ? new VertexImages({ project: vertex.project, location: vertex.location }, tokens, model, size) : new GeminiImages(v.apiKey!, model, size);
        imageCache.set(tier, (hit = { key, ai }));
      }
      return hit.ai;
    }
    if (config.ai.allowStandIns) return placeholders[tier];
    throw new AiNotConnectedError('image');
  };

  const placeholderVideo = new PlaceholderVideo();
  const video = async (model?: string): Promise<VideoAI> => {
    if (config.ai.image === 'placeholder') return placeholderVideo;
    const v = await settings.integration('gemini');
    if (vertex) return new VertexVideo({ project: vertex.project, location: vertex.videoLocation }, tokens, model || v.videoModel!);
    if (v.apiKey) return new GeminiVideo(v.apiKey, model || v.videoModel!);
    if (config.ai.allowStandIns) return placeholderVideo;
    throw new AiNotConnectedError('image');
  };

  const fakeVisual = new FakeVisual();
  let visualCache: { key: string; ai: VisualAI } | null = null;
  const visual = async (): Promise<VisualAI> => {
    if (config.ai.image === 'placeholder') return fakeVisual;
    const v = await settings.integration('gemini');
    if (v.apiKey) {
      const key = `${v.apiKey}|${v.agentModel}`;
      if (visualCache?.key !== key) visualCache = { key, ai: new GeminiVisual(v.apiKey, v.agentModel!) };
      return visualCache.ai;
    }
    if (config.ai.allowStandIns) return fakeVisual;
    throw new AiNotConnectedError('image');
  };

  const noImageSearch = new NoImageSearch();
  let visionCache: { key: string; ai: ImageSearchAI } | null = null;
  /** The CMS key first; on the cloud server, the server's own identity. Not connected: the stand-in (it is optional). */
  const imageSearch = async (): Promise<ImageSearchAI> => {
    const v = await settings.integration('google_vision');
    const key = v.apiKey ? `key:${v.apiKey}` : vertex ? `vertex:${vertex.project}` : null;
    if (!key) return noImageSearch;
    if (visionCache?.key !== key) visionCache = { key, ai: new GoogleVision(v.apiKey ? { apiKey: v.apiKey } : { tokens }) };
    return visionCache.ai;
  };

  return {
    text,
    image,
    video,
    visual,
    imageSearch,
    status: async () => {
      const [t, i] = await Promise.all([text().catch(() => null), image().catch(() => null)]);
      return { text: t?.provider ?? 'none', image: i?.provider ?? 'none', live: Boolean(t?.live && i?.live) };
    },
  };
}

/** The active version of an editable prompt (prompt_templates). */
export async function activePrompt(db: Db, key: string): Promise<{ body: string; version: number }> {
  const [row] = await db
    .select({ body: promptTemplates.body, version: promptTemplates.version })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)))
    .orderBy(desc(promptTemplates.version))
    .limit(1);
  if (!row) throw new Error(`no active prompt "${key}"`);
  return row;
}

/** A writing agent's skill, followed by the newsroom rules every agent reads (the "newsroom.rules" skill). */
export async function writerPrompt(db: Db, key: string): Promise<{ body: string; version: number }> {
  const [skill, rules] = await Promise.all([activePrompt(db, key), activePrompt(db, 'newsroom.rules').catch(() => null)]);
  return { body: rules ? `${skill.body}\n\nנהלי המערכת (חלים על כל הסוכנים):\n${rules.body}` : skill.body, version: skill.version };
}

/** House style learned from editors' corrections (the active style profile). */
export async function activeStyleRules(db: Db): Promise<string> {
  const [row] = await db.select({ rules: styleProfiles.rules }).from(styleProfiles).where(eq(styleProfiles.isActive, true)).orderBy(desc(styleProfiles.id)).limit(1);
  return row?.rules ?? 'אין עדיין כללים נלמדים. כתבו בעברית עיתונאית בהירה, משפטים קצרים, בלי סופרלטיבים.';
}

type AiJobType = (typeof aiJobs.$inferInsert)['type'];

/** Runs one AI call and records it in ai_jobs (tokens, latency, errors) for cost tracking. */
export async function tracked<T extends object>(
  db: Db,
  /**
   * costUsd: the price when the caller knows it (a video: per second), or costOf when it is known
   * only from the result (a research: its searches); text calls are otherwise priced from their tokens.
   */
  meta: {
    type: AiJobType;
    provider: string;
    draftId?: string | null;
    requestedBy?: string | null;
    promptKey?: string;
    promptVersion?: number;
    imageCount?: number;
    model?: string;
    costUsd?: number;
    costOf?: (result: T) => number | null;
  },
  call: () => Promise<T>,
): Promise<{ result: T; aiJobId: string }> {
  const started = Date.now();
  const [row] = await db
    .insert(aiJobs)
    .values({
      type: meta.type,
      provider: meta.provider,
      model: meta.model ?? 'pending',
      status: 'running',
      draftId: meta.draftId ?? null,
      requestedBy: meta.requestedBy ?? null,
      promptKey: meta.promptKey,
      promptVersion: meta.promptVersion,
      imageCount: meta.imageCount,
    })
    .returning({ id: aiJobs.id });
  const aiJobId = row!.id;
  try {
    const result = await call();
    const usage = (result as { usage?: Usage }).usage;
    const costUsd = meta.costOf ? (meta.costOf(result) ?? undefined) : meta.costUsd;
    await db
      .update(aiJobs)
      .set({
        status: 'succeeded',
        model: usage?.model ?? meta.model ?? 'unknown',
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        ...(costUsd !== undefined ? { costUsd: costUsd.toFixed(4) } : {}),
        latencyMs: Date.now() - started,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, aiJobId));
    return { result, aiJobId };
  } catch (e) {
    await db
      .update(aiJobs)
      .set({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 2000), latencyMs: Date.now() - started, finishedAt: new Date() })
      .where(eq(aiJobs.id, aiJobId));
    throw e;
  }
}
