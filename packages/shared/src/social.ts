// Contracts for the CMS social page (/admin/social/*): articles that are already
// on the site get a branded post and story, written by the AI and edited by the
// newsroom, then published to the networks the editor picks. Before an article is
// published, its distribution plan (the social editor's choices) lives here too.
import { z } from 'zod';
import { DRAFT_STATUSES, JobRef, MediaDto, SOCIAL_PLATFORMS, SOCIAL_POST_STATUSES } from './cms';

const id = z.string().uuid();
const iso = z.string();

/** Design frames. Each has a feed post (4:5) and a story (9:16) version. */
export const SHARE_TEMPLATES = ['headline', 'breaking', 'quote', 'explainer'] as const;
export type ShareTemplate = (typeof SHARE_TEMPLATES)[number];

/** What can go out for an article: a feed post, a story, a reel (video). The editor picks per article. */
export const SHARE_FORMATS = ['feed', 'story', 'reel'] as const;
export type ShareFormat = (typeof SHARE_FORMATS)[number];

/** The still designs. A reel starts from a story-sized frame of its own. */
export const DESIGN_FORMATS = ['feed', 'story'] as const;
export type DesignFormat = (typeof DESIGN_FORMATS)[number];

/** Sizes of the rendered designs (Instagram and Facebook feed 4:5, stories 9:16). */
export const SHARE_SIZES: Record<DesignFormat, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

// ---------------------------------------------------------------------------
// Reels: made in steps, each approved by the editor. The AI writes two prompts in Hebrew
// (the picture, the video) from the article and its images; then the picture (Gemini),
// then the video (Google Veo) from the clean picture. Nothing costly runs unapproved.
// ---------------------------------------------------------------------------
/**
 * prompts: the Hebrew prompts are ready for the editor; image: the picture is made, waiting for
 * approval; video: the video is made, waiting for approval; approved: ready to publish.
 */
export const REEL_STAGES = ['prompts', 'image', 'video', 'approved'] as const;
export type ReelStage = (typeof REEL_STAGES)[number];

const ReelPrompt = z.string().trim().min(5, 'ההנחיה קצרה מדי').max(1500);

export const ReelPlan = z.object({
  stage: z.enum(REEL_STAGES),
  /** What the picture shows, in Hebrew as the editor approved it (the model gets an English translation). */
  imagePrompt: ReelPrompt,
  /** What happens in the video (camera, motion, light, mood), in Hebrew. */
  videoPrompt: ReelPrompt,
  approvedAt: iso.nullable(),
  /** What the visual agent last suggested, before the editor's edits (it learns from the difference). */
  suggested: z.object({ imagePrompt: z.string(), videoPrompt: z.string() }).nullable().optional(),
  /** The directions the editor gave when asking for new prompts. */
  directions: z.array(z.string()).optional(),
  /** How many pictures and videos were made until the editor approved. */
  pictures: z.number().int().optional(),
  videos: z.number().int().optional(),
});
export type ReelPlan = z.infer<typeof ReelPlan>;

export const UpdateReelPromptsInput = z.object({ imagePrompt: ReelPrompt, videoPrompt: ReelPrompt });
export type UpdateReelPromptsInput = z.infer<typeof UpdateReelPromptsInput>;

/** "New prompts", optionally with a direction for the AI. */
export const ReelPromptsInput = z.object({ instruction: z.string().trim().max(500).optional() });

/** How the camera moves over the picture. */
export const REEL_MOTIONS = ['zoom_in', 'zoom_out', 'pan', 'parallax'] as const;
export type ReelMotion = (typeof REEL_MOTIONS)[number];
export const REEL_DURATIONS = [4, 6, 8] as const;
export const REEL_RESOLUTIONS = ['720p', '1080p'] as const;

/** The Veo models offered in the CMS (any other Google video model id can be entered in Settings). */
export const VIDEO_MODELS = ['veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview', 'veo-3.1-generate-preview'] as const;

/**
 * Estimated price per second of video, in US dollars, from Google's published rates (September 2026).
 * An estimate for the newsroom before it orders a video; the bill is Google's.
 */
export const VIDEO_PRICE_PER_SECOND: Record<string, Record<(typeof REEL_RESOLUTIONS)[number], number>> = {
  'veo-3.1-fast-generate-preview': { '720p': 0.1, '1080p': 0.12 },
  'veo-3.1-lite-generate-preview': { '720p': 0.05, '1080p': 0.08 },
  'veo-3.1-generate-preview': { '720p': 0.4, '1080p': 0.4 },
};

export const ReelSettings = z.object({
  /** Empty = the model set in Settings > Connections > Gemini */
  model: z.string().trim().regex(/^[a-z0-9][a-z0-9.\-]{2,80}$/).optional(),
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(8),
  resolution: z.enum(REEL_RESOLUTIONS).default('1080p'),
  motion: z.enum(REEL_MOTIONS).default('zoom_in'),
  /** Extra direction for the video, in the editor's words */
  instruction: z.string().trim().max(500).default(''),
});
export type ReelSettings = z.infer<typeof ReelSettings>;

export const SHARE_LIMITS = { kicker: 16, headline: 80, hook: 140, caption: 500, hashtags: 5, hashtag: 30 } as const;

export const SHARE_FILTERS = ['pending', 'shared', 'all'] as const;
export type ShareFilter = (typeof SHARE_FILTERS)[number];

export const SharePostDto = z.object({
  accountId: id,
  platform: z.enum(SOCIAL_PLATFORMS),
  displayName: z.string(),
  format: z.enum(['feed', 'story', 'message', 'reel']),
  status: z.enum(SOCIAL_POST_STATUSES),
  lastError: z.string().nullable(),
  postedAt: iso.nullable(),
});
export type SharePostDto = z.infer<typeof SharePostDto>;

export const ShareListItem = z.object({
  articleId: z.number().int(),
  title: z.string(),
  category: z.string(),
  publishedAt: iso,
  thumbUrl: z.string().nullable(),
  /** The kit exists (the AI or an editor has written it). */
  hasKit: z.boolean(),
  template: z.enum(SHARE_TEMPLATES).nullable(),
  /** The AI is writing or the designs are being rendered. */
  busy: z.boolean(),
  /** Every post of the article, from this page and from the editor's social module. */
  posts: z.array(SharePostDto),
});
export type ShareListItem = z.infer<typeof ShareListItem>;

export const ShareList = z.object({
  items: z.array(ShareListItem),
  total: z.number().int(),
  pendingCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ShareList = z.infer<typeof ShareList>;

export const ShareListQuery = z.object({
  filter: z.enum(SHARE_FILTERS).default('pending'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export const ShareTargetDto = z.object({
  id,
  platform: z.enum(SOCIAL_PLATFORMS),
  displayName: z.string(),
  /** Posts automatically (a token is set); otherwise the post is prepared for manual posting. */
  connected: z.boolean(),
  /** Formats this account can publish automatically. */
  autoFormats: z.array(z.enum(SHARE_FORMATS)),
  linkInFirstComment: z.boolean(),
});
export type ShareTargetDto = z.infer<typeof ShareTargetDto>;

export const ShareDto = z.object({
  articleId: z.number().int(),
  article: z.object({ title: z.string(), excerpt: z.string(), category: z.string(), url: z.string(), heroUrl: z.string().nullable() }),
  template: z.enum(SHARE_TEMPLATES),
  kicker: z.string(),
  headline: z.string(),
  hook: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  /** The chosen background; null = the article's main image. */
  image: MediaDto.nullable(),
  rendered: z.object({ feed: z.string().nullable(), story: z.string().nullable() }),
  /** What the editor wants for this article (only these are made). */
  formats: z.array(z.enum(SHARE_FORMATS)),
  reel: z.object({
    /** The steps so far (null = not started) */
    plan: ReelPlan.nullable(),
    /** The reel's own picture (a new Gemini image), and the branded cover made from it */
    image: MediaDto.nullable(),
    posterUrl: z.string().nullable(),
    videoUrl: z.string().nullable(),
    settings: ReelSettings,
    /** The video model that will run (the setting, or the default from Settings) */
    model: z.string(),
    /** Estimated cost of one video with these settings, in US dollars (null = unknown model) */
    estimateUsd: z.number().nullable(),
    /** Why the last reel failed, in Hebrew (null when it didn't) */
    error: z.string().nullable(),
  }),
  /** The post text as it goes out, per platform. */
  texts: z.record(z.string(), z.string()),
  version: z.number().int(),
  updatedAt: iso,
  posts: z.array(SharePostDto),
  activeJob: JobRef.nullable(),
});
export type ShareDto = z.infer<typeof ShareDto>;

const Hashtag = z
  .string()
  .trim()
  .transform((t) => t.replace(/^#+/, '').replace(/\s+/g, '_'))
  .pipe(z.string().min(1).max(SHARE_LIMITS.hashtag));

export const UpdateShareInput = z.object({
  version: z.number().int(),
  template: z.enum(SHARE_TEMPLATES),
  kicker: z.string().trim().max(SHARE_LIMITS.kicker),
  headline: z.string().trim().min(1, 'חסרה כותרת').max(SHARE_LIMITS.headline),
  hook: z.string().trim().max(SHARE_LIMITS.hook),
  caption: z.string().trim().max(SHARE_LIMITS.caption),
  hashtags: z.array(Hashtag).max(SHARE_LIMITS.hashtags),
  /** null = back to the article's main image; omitted = unchanged. */
  imageMediaId: id.nullable().optional(),
  formats: z.array(z.enum(SHARE_FORMATS)).min(1, 'בחרו לפחות פוסט, סטורי או ריל').optional(),
  reelSettings: ReelSettings.optional(),
});
export type UpdateShareInput = z.infer<typeof UpdateShareInput>;

export const GenerateSharesInput = z.object({
  articleIds: z.array(z.number().int().positive()).min(1).max(20),
  instruction: z.string().trim().max(1000).optional(),
  /** What to make for these articles; a reel is never made here (it costs a video), only marked as wanted. */
  formats: z.array(z.enum(SHARE_FORMATS)).min(1).optional(),
});

export const PublishSharesInput = z.object({
  articleIds: z.array(z.number().int().positive()).min(1).max(20),
  formats: z.array(z.enum(SHARE_FORMATS)).min(1, 'בחרו פוסט, סטורי או ריל'),
  accountIds: z.array(id).min(1, 'בחרו לפחות חשבון אחד').max(20),
});
export type PublishSharesInput = z.infer<typeof PublishSharesInput>;

// ---------------------------------------------------------------------------
// The distribution plan: when an article's text is marked final, the social editor (AI)
// decides how it goes out (the frame, a post, a story, whether a reel fits and what it
// shows) and writes the texts. The newsroom changes it quickly in a report; publishing
// the article sends it out as planned. The AI only recommends a reel: a person approves
// it, because it costs a video.
// ---------------------------------------------------------------------------
const ReelSeconds = z.union([z.literal(4), z.literal(6), z.literal(8)]);

export const ReelIdea = z.object({
  /** The AI thinks the article deserves a reel. */
  recommended: z.boolean(),
  /** Why, or why not, in one Hebrew sentence. */
  reason: z.string().max(400),
  /** What the reel shows and how it moves, in Hebrew; the visual agent writes its prompts from it. */
  idea: z.string().max(600),
  motion: z.enum(REEL_MOTIONS),
  durationSeconds: ReelSeconds,
});
export type ReelIdea = z.infer<typeof ReelIdea>;

/**
 * none: no plan yet; writing: the AI is on it; ready; stale: the text was reopened after the plan
 * was written; failed; off: this article doesn't go out to the networks; published: the article is
 * on the site and the plan moved to the social page.
 */
export const PLAN_STATES = ['none', 'writing', 'ready', 'stale', 'failed', 'off', 'published'] as const;
export type PlanState = (typeof PLAN_STATES)[number];

export const SocialPlanDto = z.object({
  draftId: id,
  title: z.string(),
  category: z.string().nullable(),
  draftStatus: z.enum(DRAFT_STATUSES),
  state: z.enum(PLAN_STATES),
  enabled: z.boolean(),
  template: z.enum(SHARE_TEMPLATES),
  kicker: z.string(),
  headline: z.string(),
  hook: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  /** What goes out when the article is published. "reel" is there only when a person approved it. */
  formats: z.array(z.enum(SHARE_FORMATS)),
  reel: ReelIdea.nullable(),
  /** Estimated price of the reel's video at its length, in US dollars (null = unknown model). */
  reelEstimateUsd: z.number().nullable(),
  /** The AI's reasons, in Hebrew, for the report. */
  reasons: z.object({ template: z.string(), formats: z.string() }),
  /** The AI's own choices, so the report shows what a person changed. */
  aiChoice: z.object({ template: z.enum(SHARE_TEMPLATES), formats: z.array(z.enum(SHARE_FORMATS)), reel: z.boolean() }).nullable(),
  /** The background photo; null = the article's main image. */
  image: MediaDto.nullable(),
  heroUrl: z.string().nullable(),
  rendered: z.object({ feed: z.string().nullable(), story: z.string().nullable() }),
  /** Once published: the article, what went out, and where its reel stands. */
  articleId: z.number().int().nullable(),
  posts: z.array(SharePostDto),
  reelStage: z.enum(REEL_STAGES).nullable(),
  /** Why the AI couldn't write the plan, in Hebrew (null when it could). */
  error: z.string().nullable(),
  version: z.number().int(),
  updatedAt: iso.nullable(),
});
export type SocialPlanDto = z.infer<typeof SocialPlanDto>;

/** The report: articles waiting to be published with their plans, and what went out recently. */
export const SocialPlanReport = z.object({
  pending: z.array(SocialPlanDto),
  recent: z.array(SocialPlanDto),
  /** Publishing an article sends its plan out (the newsroom can turn this off). */
  autoPost: z.boolean(),
});
export type SocialPlanReport = z.infer<typeof SocialPlanReport>;

export const UpdateSocialPlanInput = z.object({
  version: z.number().int(),
  /** false = this article doesn't go out to the networks automatically. */
  enabled: z.boolean().optional(),
  template: z.enum(SHARE_TEMPLATES).optional(),
  formats: z.array(z.enum(SHARE_FORMATS)).min(1, 'בחרו לפחות פוסט, סטורי או ריל').optional(),
  kicker: z.string().trim().max(SHARE_LIMITS.kicker).optional(),
  headline: z.string().trim().min(1, 'חסרה כותרת').max(SHARE_LIMITS.headline).optional(),
  hook: z.string().trim().max(SHARE_LIMITS.hook).optional(),
  caption: z.string().trim().max(SHARE_LIMITS.caption).optional(),
  hashtags: z.array(Hashtag).max(SHARE_LIMITS.hashtags).optional(),
  /** What the reel shows, in the editor's words (the AI's idea otherwise). */
  reelIdea: z.string().trim().max(600).optional(),
  reelSeconds: ReelSeconds.optional(),
  /** null = back to the article's main image; omitted = unchanged. */
  imageMediaId: id.nullable().optional(),
});
export type UpdateSocialPlanInput = z.infer<typeof UpdateSocialPlanInput>;

/** "Write the plan again", optionally with a direction for the AI. */
export const RegenerateSocialPlanInput = z.object({ instruction: z.string().trim().max(1000).optional() });
