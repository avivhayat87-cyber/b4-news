// What the newsroom asks of the AI. Text: Anthropic; the visual agent, images and
// video: Google Gemini; and a deterministic stand-in of each for development and tests.
import { AD_ACTIONS, AD_LEAD_FIELDS, AD_SLOTS, CATEGORY_SLUGS, CLAIM_LABELS, OFFICIAL_PLATFORMS, REEL_MOTIONS, RESEARCH_DEPTHS, REVIEW_FLAGS, REVIEW_WHERE, SHARE_TEMPLATES, SOURCE_KINDS, type ResearchDepth, type ResearchKind } from '@b4/shared';
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

export type RewriteSource = { title: string; intro: string | null; body: string; sourceName: string; url: string; language?: string | null };

export type RewriteRequest = {
  /** prompt_templates "rewrite.system", or "rewrite.combine" when there are extraSources */
  systemPrompt: string;
  /** language: ISO 639-1 of a foreign original (null = Hebrew). */
  source: RewriteSource;
  /** The same story from other sites: one article is written from all of them (source is the main one). */
  extraSources?: RewriteSource[];
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
  input: { kind: ResearchKind; url: string | null; pageText: string | null; images: ImageReference[]; note: string; /** Where the images already appeared on the web (reverse image search), as text; empty when not searched. */ imageMatches?: string };
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

/** The chief editor's picks after a discovery run: the stories to take first, each with a score (1-100) and a short reason. */
export const DiscoveryPickOutput = z.object({
  picks: upTo(z.object({ id: clip(20), score: z.number(), reason: clip(300) }), 80),
});
export type DiscoveryPickOutput = z.infer<typeof DiscoveryPickOutput>;

export type DiscoveryPickRequest = {
  /** prompt_templates "discovery.pick" */
  systemPrompt: string;
  /** How many stories to recommend. */
  count: number;
  /** The leisure sections (Hebrew names): fewer of those. */
  leisure: string[];
  /** The run's stories: id, how many sites, the section (Hebrew name), the headlines with their sites. */
  stories: { id: string; sites: number; section: string | null; headlines: { title: string; source: string }[] }[];
  /** What we published lately, so it isn't recommended again without something new. */
  published: string[];
  today: string;
};

/** The chief editor's placement of a batch: per article where it goes on the site, the ticker, a section when it has none, and why. */
export const DeskPlanOutput = z.object({
  items: upTo(
    z.object({
      id: clip(20),
      placement: z.enum(['main', 'trending', 'none']),
      ticker: z.boolean(),
      section: z.string().nullable(),
      rank: z.number().int(),
      reason: clip(300),
    }),
    60,
  ),
});
export type DeskPlanOutput = z.infer<typeof DeskPlanOutput>;

export type DeskPlanRequest = {
  /** prompt_templates "desk.plan" */
  systemPrompt: string;
  today: string;
  /** The batch: id, headline, subtitle, opening, section (Hebrew name, or null), how many sites reported it, the discovery score. */
  articles: { id: string; title: string; subtitle: string; opening: string; section: string | null; sites: number; score: number | null }[];
  /** What the site shows now: the main stories (the first is the lead), the hot ones and the ticker, each with how long ago. */
  homepage: { main: string[]; trending: string[]; ticker: string[] };
  /** The sections an article without one may get (slug and Hebrew name). */
  sections: { slug: string; name: string }[];
  /** Recent places where the editors changed the chief editor's choice. */
  corrections: string[];
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

/** Where an image appeared on the web before (reverse image search). */
export type WebDetection = {
  /** What the image seems to show, in Google's words. */
  bestGuess: string[];
  pages: { url: string; title: string }[];
  fullMatches: number;
  partialMatches: number;
  similar: number;
};

/** Reverse image search (Google Vision's web detection), with a stand-in that finds nothing. */
export interface ImageSearchAI {
  readonly provider: string;
  readonly live: boolean;
  webDetect(image: ImageReference): Promise<WebDetection>;
}

/** An update of an article we already have, from a research file: only what is new. */
export const ResearchUpdateOutput = z.object({
  paragraphs: upTo(z.string(), 20),
  /** Empty paragraphs: why there is nothing to add. */
  nothing_new: clip(600),
});
export type ResearchUpdateOutput = z.infer<typeof ResearchUpdateOutput>;

export type ResearchUpdateRequest = {
  /** prompt_templates "research.update", with the newsroom rules */
  systemPrompt: string;
  styleRules: string;
  dossier: string;
  existing: { title: string; subtitle: string; body: string };
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

// ---------------------------------------------------------------------------
// The ads agent: proposes campaigns, checks ads, sums up for the advertiser (Hebrew). A person
// approves everything it writes before readers see it.
// ---------------------------------------------------------------------------
export const AdBriefOutput = z.object({
  summary: clip(800),
  headlines: upTo(clip(90), 5),
  bodies: upTo(clip(200), 5),
  ctas: upTo(clip(30), 5),
  slots: upTo(z.enum(AD_SLOTS), AD_SLOTS.length),
  categories: upTo(z.enum(CATEGORY_SLUGS), 6),
  action: z.enum(AD_ACTIONS),
  lead_fields: upTo(z.enum(AD_LEAD_FIELDS), AD_LEAD_FIELDS.length),
  lead_question: clip(200),
  image_idea: clip(800),
  warnings: upTo(clip(300), 8),
});
export type AdBriefOutput = z.infer<typeof AdBriefOutput>;

export type AdBriefRequest = {
  /** prompt_templates "ads.brief" */
  systemPrompt: string;
  /** What the places are, generated from the code. */
  options: string;
  brief: { business: string; website: string; offer: string; goal: string; audience: string; notes: string };
  /** The advertiser's home page as we read it (untrusted), or empty. */
  siteText: string;
};

export const AdReviewOutput = z.object({
  verdict: z.enum(['ok', 'fix', 'block']),
  issues: upTo(z.object({ what: clip(300), why: clip(600), fix: clip(600) }), 10),
});
export type AdReviewOutput = z.infer<typeof AdReviewOutput>;

export type AdReviewRequest = {
  /** prompt_templates "ads.review" */
  systemPrompt: string;
  ad: { advertiser: string; sponsor: string; format: string; headline: string; body: string; cta: string; alt: string; url: string; action: string; leadQuestion: string };
  /** The banner as readers see it (its words are in the picture). */
  images: ImageReference[];
};

export const AdReportOutput = z.object({ note: z.string().min(1).transform((s) => s.slice(0, 2000)) });
export type AdReportOutput = z.infer<typeof AdReportOutput>;

export type AdReportRequest = {
  /** prompt_templates "ads.report" */
  systemPrompt: string;
  /** The campaign and its numbers, as text. */
  facts: string;
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
  researchUpdate(req: ResearchUpdateRequest): Promise<AiResult<ResearchUpdateOutput>>;
  meeting(req: MeetingRequest): Promise<AiResult<MeetingOutput>>;
  /** The chief editor's picks after a discovery run (the fast model). */
  discoveryPick(req: DiscoveryPickRequest): Promise<AiResult<DiscoveryPickOutput>>;
  /** The chief editor places a batch on the site (the fast model, one call per batch). */
  deskPlan(req: DeskPlanRequest): Promise<AiResult<DeskPlanOutput>>;
  /** The official-sources registry: a body's accounts its site doesn't link (two searches at most). */
  findAccounts(req: AccountsRequest): Promise<AiResult<AccountsOutput> & { searches: number; toolErrors: string[] }>;
  review(req: ReviewRequest): Promise<AiResult<ReviewOutput>>;
  reviewFix(req: ReviewFixRequest): Promise<AiResult<ReviewFixOutput>>;
  translate(req: TranslateRequest): Promise<AiResult<TranslateOutput>>;
  distill(req: DistillRequest): Promise<AiResult<DistillOutput>>;
  learnBatch(req: LearnBatchRequest): Promise<AiResult<LearnBatchOutput>>;
  /** Hebrew prompts the editor approved, in English for the image and video models (same order). */
  toEnglish(texts: string[]): Promise<AiResult<EnglishOutput>>;
  adBrief(req: AdBriefRequest): Promise<AiResult<AdBriefOutput>>;
  adReview(req: AdReviewRequest): Promise<AiResult<AdReviewOutput>>;
  adReport(req: AdReportRequest): Promise<AiResult<AdReportOutput>>;
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
/**
 * The descriptions of an article's image options, in Hebrew, one per style (each is drawn once), and
 * the public figure the story is about, if there is one (a real photo of them may be looked for).
 */
export const ImagePromptOutput = z.object({
  prompts: z.array(z.string().min(5).max(1500)).min(1).max(3),
  /** Empty names (or null) when the story isn't about one public figure. */
  public_figure: z.object({ name_he: clip(120), name_en: clip(120) }).nullable(),
});
export type ImagePromptOutput = z.infer<typeof ImagePromptOutput>;

export type ImagePromptRequest = {
  /** prompt_templates "visual.image" */
  systemPrompt: string;
  /** The newsroom's settings and the rules the agent learned. */
  guidance: string;
  /** The three styles: one description each, in this order. */
  styles: string[];
  article: ArticleText & { section: string };
  /** The original report's photo, when the editor asked for it as inspiration (looked at, never copied). */
  images: ImageReference[];
  /** Descriptions already drawn for this article: the editor asked for something else. */
  tried: string[];
};

/** The option the visual agent recommends for the article (1-based), and why, in Hebrew. */
export const ImagePickOutput = z.object({ choice: z.number().int().min(1).max(6), reason: clip(400) });
export type ImagePickOutput = z.infer<typeof ImagePickOutput>;

export type ImagePickRequest = {
  /** prompt_templates "visual.pick" */
  systemPrompt: string;
  guidance: string;
  article: ArticleText & { section: string };
  /** The options in order, each with what it is (a style, or a real photo and its credit). */
  options: { label: string; image: ImageReference }[];
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
  /** Looks at the drawn options (small JPEGs) and recommends one for the article. */
  pickImage(req: ImagePickRequest): Promise<AiResult<ImagePickOutput>>;
  reelPrompts(req: ReelPromptsRequest): Promise<AiResult<ReelPromptsOutput>>;
  learn(req: VisualLearnRequest): Promise<AiResult<LearnBatchOutput>>;
}

export type Ai = { text: TextAI; image: ImageAI };
