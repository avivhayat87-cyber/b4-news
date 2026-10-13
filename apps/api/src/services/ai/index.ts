import { type Db, aiJobs, and, desc, eq, promptTemplates, styleProfiles } from '@b4/db';
import type { Config } from '../../config';
import { PermanentJobError } from '../../lib/jobs';
import type { SettingsStore } from '../settings';
import { AnthropicText } from './anthropic';
import { FakeText, FakeVisual, PlaceholderImages, PlaceholderVideo } from './fake';
import { GeminiImages, type ImageSize } from './gemini-images';
import { GeminiVideo } from './gemini-video';
import { GeminiVisual } from './gemini-visual';
import type { ImageAI, ImageTier, TextAI, Usage, VideoAI, VisualAI } from './types';

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
export function fixedAi(text: TextAI, image: ImageAI, draftImage: ImageAI = image, video: VideoAI = new PlaceholderVideo(), visual: VisualAI = new FakeVisual()): AiHub {
  return {
    text: async () => text,
    image: async (tier = 'final') => (tier === 'draft' ? draftImage : image),
    video: async () => video,
    visual: async () => visual,
    status: async () => ({ text: text.provider, image: image.provider, live: text.live && image.live }),
  };
}

export function createAiHub(config: Config, settings: SettingsStore): AiHub {
  const fakeText = new FakeText();
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
    if (v.apiKey) {
      const [model, size] = tier === 'draft' ? [v.previewModel!, DRAFT_SIZE] : [v.imageModel!, v.imageSize as ImageSize];
      const key = `${v.apiKey}|${model}|${size}`;
      let hit = imageCache.get(tier);
      if (hit?.key !== key) imageCache.set(tier, (hit = { key, ai: new GeminiImages(v.apiKey, model, size) }));
      return hit.ai;
    }
    if (config.ai.allowStandIns) return placeholders[tier];
    throw new AiNotConnectedError('image');
  };

  const placeholderVideo = new PlaceholderVideo();
  const video = async (model?: string): Promise<VideoAI> => {
    if (config.ai.image === 'placeholder') return placeholderVideo;
    const v = await settings.integration('gemini');
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

  return {
    text,
    image,
    video,
    visual,
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

/** House style learned from editors' corrections (the active style profile). */
export async function activeStyleRules(db: Db): Promise<string> {
  const [row] = await db.select({ rules: styleProfiles.rules }).from(styleProfiles).where(eq(styleProfiles.isActive, true)).orderBy(desc(styleProfiles.id)).limit(1);
  return row?.rules ?? 'אין עדיין כללים נלמדים. כתבו בעברית עיתונאית בהירה, משפטים קצרים, בלי סופרלטיבים.';
}

type AiJobType = (typeof aiJobs.$inferInsert)['type'];

/** Runs one AI call and records it in ai_jobs (tokens, latency, errors) for cost tracking. */
export async function tracked<T extends object>(
  db: Db,
  meta: { type: AiJobType; provider: string; draftId?: string | null; requestedBy?: string | null; promptKey?: string; promptVersion?: number; imageCount?: number; model?: string },
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
    await db
      .update(aiJobs)
      .set({
        status: 'succeeded',
        model: usage?.model ?? meta.model ?? 'unknown',
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
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
