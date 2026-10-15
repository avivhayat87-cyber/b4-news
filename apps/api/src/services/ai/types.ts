// What the newsroom asks of the AI. Text: Anthropic; the visual agent, images and
// video: Google Gemini; and a deterministic stand-in of each for development and tests.
import { CATEGORY_SLUGS, CLAIM_LABELS, OFFICIAL_PLATFORMS, REEL_MOTIONS, RESEARCH_DEPTHS, REVIEW_FLAGS, REVIEW_WHERE, SHARE_TEMPLATES, SOURCE_KINDS, type ResearchDepth, type ResearchKind } from '@b4/shared';
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
  /** prompt_templates "refine.system", with the newsroom rules */
  systemPrompt: string;
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

// A research is paid for before its file arrives: a file that runs long is trimmed, never refused.
const clip = (n: number) => z.string().transform((s) => s.slice(0, n));
const upTo = <T extends z.ZodTypeAny>(item: T, n: number) => z.array(item).transform((a) => a.slice(0, n));

/** The research reporter's file, as the model submits it (the service gives ids and checks the sources). */
export const ResearchOutput = z.object({
  original: z.object({ who: clip(300), when: clip(100), what: clip(3000), url: clip(2000) }),
  summary: clip(3000),
  claims: upTo(z.object({ text: clip(1000), label: z.enum(CLAIM_LABELS), source_urls: upTo(clip(2000), 10), note: clip(600) }), 40),
  background: upTo(clip(2500), 10),
  open_questions: upTo(clip(600), 10),
  response_needed: upTo(clip(200), 10),
  sources: upTo(z.object({ url: clip(2000), title: clip(500), publisher: clip(200), kind: z.enum(SOURCE_KINDS), used_for: z.enum(['fact', 'lead', 'background']) }), 40),
});
export type ResearchOutput = z.infer<typeof ResearchOutput>;

export type ResearchRequest = {
  /** prompt_templates "research.system", with the newsroom rules */
  systemPrompt: string;
  /** The newsroom's approved sources besides official ones (domains or account addresses). */
  approvedSources: string[];
  depth: ResearchDepth;
  /** For an idea, note is the idea itself. */
  input: { kind: ResearchKind; url: string | null; pageText: string | null; images: ImageReference[]; note: string };
  /** Israel time, so "today" and "yesterday" in a report are understood. */
  today: string;
};

/** An official body's accounts on the networks, each with the official page that links to it (checked by the code). */
export const AccountsOutput = z.object({
  accounts: upTo(z.object({ platform: z.enum(OFFICIAL_PLATFORMS), url: clip(500), evidence_url: clip(1000) }), 12),
});
export type AccountsOutput = z.infer<typeof AccountsOutput>;

export type AccountsRequest = {
  /** prompt_templates "research.accounts" */
  systemPrompt: string;
  body: { name: string; homepage: string; domains: string[]; known: string[] };
};

/** The editorial meeting: original story pitches from the topics discovery found. */
export const MeetingOutput = z.object({
  summary: clip(1500),
  pitches: upTo(
    z.object({
      title: clip(300),
      angle: clip(1500),
      why_now: clip(800),
      checks: upTo(clip(400), 8),
      official_sources: upTo(clip(200), 8),
      category: z.enum(CATEGORY_SLUGS).nullable(),
      cluster_ids: upTo(clip(20), 10),
      depth: z.enum(RESEARCH_DEPTHS),
    }),
    8,
  ),
});
export type MeetingOutput = z.infer<typeof MeetingOutput>;

export type MeetingRequest = {
  /** prompt_templates "meeting.pitch" */
  systemPrompt: string;
  focus: string;
  /** The topics, as the model reads them: id, how many sites, the headlines with their sites and sections. */
  topics: { id: string; sites: number; category: string | null; headlines: { title: string; source: string; at: string }[] }[];
  /** What we published lately, so the meeting doesn't propose it again. */
  published: string[];
  today: string;
};

/** The article written from the file (no image prompt: the visual agent writes those). Trimmed, never refused: the research is already paid for. */
export const ResearchWriteOutput = z.object({
  title: z.string().min(1).transform((s) => s.slice(0, 200)),
  subtitle: clip(400),
  paragraphs: z.array(z.string()).min(1).transform((a) => a.slice(0, 80)),
  suggested_category: z.enum(CATEGORY_SLUGS).nullable().catch(null),
  suggested_tags: upTo(clip(40), 8),
});
export type ResearchWriteOutput = z.infer<typeof ResearchWriteOutput>;

export type ResearchWriteRequest = {
  /** prompt_templates "research.write", with the newsroom rules */
  systemPrompt: string;
  styleRules: string;
  /** The file, with each detail's label and its sources' publishers. */
  dossier: string;
  note: string;
};

/** The legal review: only the risks a person must decide on (Hebrew reasons and advice). */
export const ReviewOutput = z.object({
  issues: z
    .array(
      z.object({
        flag: z.enum(REVIEW_FLAGS),
        where: z.enum(REVIEW_WHERE),
        quote: z.string().max(2000),
        subject: z.string().max(200),
        why: z.string().max(600),
        advice: z.string().max(600),
      }),
    )
    .max(20),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

export const ReviewFixOutput = z.object({ after: z.string().min(1).max(4000) });
export type ReviewFixOutput = z.infer<typeof ReviewFixOutput>;

export type ReviewRequest = {
  /** prompt_templates "review.system" */
  systemPrompt: string;
  article: ArticleText & { section: string };
};

export type ReviewFixRequest = {
  /** prompt_templates "review.fix" */
  systemPrompt: string;
  issue: { flag: string; why: string; advice: string; subject: string };
  /** The passage to rewrite, and the paragraph around it for context. */
  quote: string;
  context: string;
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
  /** searches: how many web searches it made (each is billed apart from the tokens); toolErrors: searches or fetches that failed. */
  research(req: ResearchRequest): Promise<AiResult<ResearchOutput> & { searches: number; toolErrors: string[] }>;
  researchWrite(req: ResearchWriteRequest): Promise<AiResult<ResearchWriteOutput>>;
  meeting(req: MeetingRequest): Promise<AiResult<MeetingOutput>>;
  /** The official-sources registry: a body's accounts its site doesn't link (two searches at most). */
  findAccounts(req: AccountsRequest): Promise<AiResult<AccountsOutput> & { searches: number; toolErrors: string[] }>;
  review(req: ReviewRequest): Promise<AiResult<ReviewOutput>>;
  reviewFix(req: ReviewFixRequest): Promise<AiResult<ReviewFixOutput>>;
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
  /** The size it draws at (1K, 2K, 4K), which sets the price; none for the stand-in. */
  readonly size?: string;
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
