// What the newsroom asks of the AI. Text: Anthropic; the visual agent, images and
// video: Google Gemini; and a deterministic stand-in of each for development and tests.
import { CATEGORY_SLUGS, REEL_MOTIONS, SHARE_TEMPLATES } from '@b4/shared';
import { z } from 'zod';

export type Usage = { model: string; inputTokens: number | null; outputTokens: number | null; latencyMs: number };
export type AiResult<T> = { data: T; usage: Usage };

export const RewriteOutput = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(400),
  paragraphs: z.array(z.string()).min(1).max(80),
  suggested_category: z.enum(CATEGORY_SLUGS).nullable(),
  suggested_tags: z.array(z.string().max(40)).max(8),
  image_prompt: z.string().max(1000),
});
export type RewriteOutput = z.infer<typeof RewriteOutput>;

export const RefineOutput = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(400),
  paragraphs: z.array(z.string()).min(1).max(80),
  /** One or two sentences to the editor about what changed. */
  reply: z.string().max(600),
});
export type RefineOutput = z.infer<typeof RefineOutput>;

export const SocialOutput = z.object({
  headline: z.string().min(1).max(120),
  caption: z.string().min(1).max(600),
  image_prompt: z.string().max(1000),
});
export type SocialOutput = z.infer<typeof SocialOutput>;

/** The social page: text for a branded post + story of a published article. */
export const ShareKitOutput = z.object({
  template: z.enum(SHARE_TEMPLATES),
  kicker: z.string().max(40),
  headline: z.string().min(1).max(160),
  hook: z.string().max(280),
  caption: z.string().max(1000),
  hashtags: z.array(z.string().max(60)).max(8),
});
export type ShareKitOutput = z.infer<typeof ShareKitOutput>;

/** The distribution plan: the kit, plus how the article goes out and whether a reel fits (reasons in Hebrew). */
export const SocialPlanOutput = ShareKitOutput.extend({
  template_reason: z.string().max(400),
  feed: z.boolean(),
  story: z.boolean(),
  formats_reason: z.string().max(400),
  reel_recommended: z.boolean(),
  reel_reason: z.string().max(400),
  reel_idea: z.string().max(600),
  reel_motion: z.enum(REEL_MOTIONS),
  reel_seconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
});
export type SocialPlanOutput = z.infer<typeof SocialPlanOutput>;

/** Hebrew translation of foreign articles (headlines after discovery, full text for the editor). */
export const TranslateOutput = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string().max(1000), intro: z.string().max(4000), body: z.string().max(120_000) })),
});
export type TranslateOutput = z.infer<typeof TranslateOutput>;

export const DistillOutput = z.object({ rules: z.string().min(1).max(6000) });
export type DistillOutput = z.infer<typeof DistillOutput>;

/** One learning pass over a publish batch: the updated rules and what was learned (Hebrew, for the newsroom). */
export const LearnBatchOutput = z.object({ rules: z.string().min(1).max(6000), summary: z.string().max(3000) });
export type LearnBatchOutput = z.infer<typeof LearnBatchOutput>;

/** A reel's two prompts, in Hebrew for the editor: what the picture shows, and what happens in the video. */
export const ReelPromptsOutput = z.object({ image_prompt: z.string().min(5).max(1500), video_prompt: z.string().min(5).max(1500) });
export type ReelPromptsOutput = z.infer<typeof ReelPromptsOutput>;

export const EnglishOutput = z.object({ texts: z.array(z.string()) });
export type EnglishOutput = z.infer<typeof EnglishOutput>;

export type ArticleText = { title: string; subtitle: string; body: string };

export type RewriteRequest = {
  systemPrompt: string;
  /** language: ISO 639-1 of a foreign original (null = Hebrew). */
  source: { title: string; intro: string | null; body: string; sourceName: string; url: string; language?: string | null };
};

export type RefineRequest = {
  styleRules: string;
  current: ArticleText;
  instruction: string;
  selection?: string;
  /** The original report, so "add the detail about X" can be answered from the facts. */
  original?: string;
};

export type SocialRequest = {
  systemPrompt: string;
  article: ArticleText;
  current?: { headline: string; caption: string };
  instruction?: string;
};

export type ShareKitRequest = {
  systemPrompt: string;
  article: ArticleText & { section: string };
  current?: Omit<ShareKitOutput, 'template'>;
  instruction?: string;
};

export type SocialPlanRequest = {
  /** prompt_templates "social.plan" */
  systemPrompt: string;
  /** Every option the system has (frames, formats, reel settings and prices, the accounts), generated from the code. */
  options: string;
  /** The newsroom's settings and the plans the editors recently changed. */
  guidance: string;
  article: ArticleText & { section: string };
  instruction?: string;
};

export type TranslateRequest = {
  /** prompt_templates "translate.system" */
  systemPrompt: string;
  /** ISO 639-1 of the source, or null if unknown. */
  language: string | null;
  items: { id: string; title: string; intro?: string | null; body?: string | null }[];
};

export type DistillRequest = {
  currentRules: string;
  examples: { aiText: string; finalText: string; diff: string; editRatio: number }[];
};

/** A publish batch, compacted: per article the source excerpt, the AI-to-final diff and the image choice. */
export type LearnBatchRequest = {
  /** prompt_templates "learning.batch" */
  systemPrompt: string;
  currentRules: string;
  /** The editor agent's settings, so lessons that contradict them are not turned into rules. */
  settings: string;
  articles: { section: string; source: string; diff: string; editRatio: number; images: string }[];
};

export interface TextAI {
  readonly provider: string;
  /** False for the development stand-in: the UI says the text was not really rewritten. */
  readonly live: boolean;
  rewrite(req: RewriteRequest): Promise<AiResult<RewriteOutput>>;
  refine(req: RefineRequest): Promise<AiResult<RefineOutput>>;
  social(req: SocialRequest): Promise<AiResult<SocialOutput>>;
  shareKit(req: ShareKitRequest): Promise<AiResult<ShareKitOutput>>;
  socialPlan(req: SocialPlanRequest): Promise<AiResult<SocialPlanOutput>>;
  translate(req: TranslateRequest): Promise<AiResult<TranslateOutput>>;
  distill(req: DistillRequest): Promise<AiResult<DistillOutput>>;
  learnBatch(req: LearnBatchRequest): Promise<AiResult<LearnBatchOutput>>;
  /** Hebrew prompts the editor approved, in English for the image and video models (same order). */
  toEnglish(texts: string[]): Promise<AiResult<EnglishOutput>>;
}

export type ImageShape = 'landscape' | 'portrait';

/** draft: quick, cheap, low-resolution options to choose from; final: full quality. */
export type ImageTier = 'draft' | 'final';

/** An image the generator may look at (the original's photo as inspiration, or the draft to redraw). */
export type ImageReference = { data: Buffer; mimeType: string };

export interface ImageAI {
  readonly provider: string;
  readonly model: string;
  readonly live: boolean;
  generate(prompt: string, opts: { count: number; shape: ImageShape; references?: ImageReference[] }): Promise<Buffer[]>;
  /** The approved draft, redrawn at this generator's quality and kept as it is. */
  finish(prompt: string, draft: ImageReference, shape: ImageShape): Promise<Buffer>;
}

/** Image-to-video: the first frame comes in, a short vertical video comes out. */
export type VideoRequest = {
  prompt: string;
  firstFrame: ImageReference;
  durationSeconds: 4 | 6 | 8;
  resolution: '720p' | '1080p';
  aspectRatio: '9:16' | '16:9';
};

export interface VideoAI {
  readonly provider: string;
  readonly model: string;
  /** False for the development stand-in, which makes no video (data is null). */
  readonly live: boolean;
  generate(req: VideoRequest): Promise<AiResult<{ video: Buffer | null; mimeType: string }>>;
}

// ---------------------------------------------------------------------------
// The visual agent (Google Gemini): writes the prompts for article images and reels,
// in Hebrew for the editor, and learns from what the editors did with them.
// ---------------------------------------------------------------------------
/** The description of an article's main image, in Hebrew. */
export const ImagePromptOutput = z.object({ prompt: z.string().min(5).max(1500) });
export type ImagePromptOutput = z.infer<typeof ImagePromptOutput>;

export type ImagePromptRequest = {
  /** prompt_templates "visual.image" */
  systemPrompt: string;
  /** The newsroom's settings and the rules the agent learned. */
  guidance: string;
  article: ArticleText & { section: string };
  /** The original report's photo, when the editor asked for it as inspiration (looked at, never copied). */
  images: ImageReference[];
  /** Descriptions already drawn for this article: the editor asked for something else. */
  tried: string[];
};

export type ReelPromptsRequest = {
  /** prompt_templates "reel.prompts" */
  systemPrompt: string;
  guidance: string;
  article: ArticleText & { section: string; hook: string };
  /** The article's main image and the original report's photo, to look at (never copied). */
  images: ImageReference[];
  /** The editor's current prompts and direction, when asking for new ones. */
  current?: { imagePrompt: string; videoPrompt: string };
  instruction?: string;
};

/** A learning pass: the cases since the last one, each with its pictures (chosen first). */
export type VisualLearnRequest = {
  /** prompt_templates "visual.learn" */
  systemPrompt: string;
  currentRules: string;
  /** The newsroom's settings, so lessons that contradict them are not turned into rules. */
  settings: string;
  cases: { text: string; images: { label: string; image: ImageReference }[] }[];
};

export interface VisualAI {
  readonly provider: string;
  readonly model: string;
  /** False for the development stand-in. */
  readonly live: boolean;
  imagePrompt(req: ImagePromptRequest): Promise<AiResult<ImagePromptOutput>>;
  reelPrompts(req: ReelPromptsRequest): Promise<AiResult<ReelPromptsOutput>>;
  learn(req: VisualLearnRequest): Promise<AiResult<LearnBatchOutput>>;
}

export type Ai = { text: TextAI; image: ImageAI };
