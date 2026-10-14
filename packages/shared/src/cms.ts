// Contracts between the CMS (apps/admin) and the admin API (/api/v1/admin/*).
import { z } from 'zod';
import { PROMPT_AUTHORS } from './agent';
import { STAFF_ROLES } from './auth';
import { CATEGORY_SLUGS } from './categories';

const id = z.string().uuid();
const iso = z.string();
const HttpUrl = z
  .string()
  .trim()
  .max(2000)
  .url('כתובת לא תקינה')
  .refine((u) => /^https?:\/\//i.test(u), 'רק כתובות http או https');
const CssSelector = z.string().trim().min(1).max(300);
const CategorySlugField = z.enum(CATEGORY_SLUGS);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
/** Israeli sites and sites from abroad: listed, found and scanned separately. */
export const SOURCE_REGIONS = ['local', 'international'] as const;
export type SourceRegion = (typeof SOURCE_REGIONS)[number];
export const SOURCE_STATUSES = ['pending_dev', 'in_development', 'active', 'paused', 'broken', 'archived'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
/** Methods the scraper implements. ("html_js", headless rendering, is reserved for later.) */
export const SCRAPE_METHODS = ['rss', 'sitemap', 'html'] as const;
export type ScrapeMethod = (typeof SCRAPE_METHODS)[number];
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'] as const;
export const DRAFT_STATUSES = ['queued_ai', 'ai_processing', 'ai_failed', 'editing', 'text_final', 'ready', 'skipped', 'published'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export const DRAFT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type DraftColor = (typeof DRAFT_COLORS)[number];
export const DRAFT_ORIGINS = ['scraped', 'manual_url', 'manual_write'] as const;
export const PLACEMENTS = ['main', 'trending', 'none'] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const MAGAZINE_STATUSES = ['draft', 'editing', 'ready', 'publishing', 'published', 'partially_failed', 'archived'] as const;
export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'telegram', 'whatsapp', 'x', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SOCIAL_POST_STATUSES = ['draft', 'queued', 'posting', 'posted', 'comment_failed', 'failed', 'skipped'] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/** Facebook, Instagram and X: the article link goes in the first comment, never in the post. */
export const LINK_IN_FIRST_COMMENT: Record<SocialPlatform, boolean> = {
  facebook: true,
  instagram: true,
  x: true,
  telegram: false,
  whatsapp: false,
  tiktok: false,
};

// ---------------------------------------------------------------------------
// Sources (site settings)
// ---------------------------------------------------------------------------
/** How the scraper reads one source. Written by the developer while setting the source up. */
export const SelectorConfig = z.object({
  /** html method: how to find articles on the listing pages. */
  list: z
    .object({
      item: CssSelector.optional(),
      link: CssSelector.optional(),
      title: CssSelector.optional(),
      publishedAt: CssSelector.optional(),
      maxItems: z.number().int().min(1).max(200).default(40),
      /** Keep only articles whose address contains this (e.g. "/economy" on a whole-site sitemap). */
      /** Keep only addresses containing this; several parts separated by spaces must all appear ("/economy/ /article-"). */
      urlFilter: z.string().trim().min(1).max(200).optional(),
    })
    .default({}),
  /** How to read an article page. Omit to use only what the feed provides. */
  article: z
    .object({
      title: CssSelector.optional(),
      intro: CssSelector.optional(),
      body: CssSelector.optional(),
      image: CssSelector.optional(),
      publishedAt: CssSelector.optional(),
      remove: z.array(CssSelector).max(30).default([]),
    })
    .optional(),
  /** First match wins; otherwise the source's default category, otherwise AI classification. */
  categoryRules: z.array(z.object({ urlContains: z.string().trim().min(1).max(200), category: CategorySlugField })).max(50).default([]),
});
export type SelectorConfig = z.output<typeof SelectorConfig>;

export const SourceDto = z.object({
  id,
  name: z.string(),
  baseUrl: z.string(),
  listUrls: z.array(z.string()),
  method: z.enum(SCRAPE_METHODS).nullable(),
  selectorConfig: SelectorConfig.nullable(),
  defaultCategory: z.string().nullable(),
  region: z.enum(SOURCE_REGIONS),
  /** ISO 639-1 (e.g. "en"); null = Hebrew or not detected yet. */
  language: z.string().nullable(),
  status: z.enum(SOURCE_STATUSES),
  scrapeIntervalMin: z.number().int(),
  lastSuccessAt: iso.nullable(),
  lastTestPassedAt: iso.nullable(),
  consecutiveFailures: z.number().int(),
  devNotes: z.string().nullable(),
  requestedBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: iso.nullable(),
  createdAt: iso,
  /** Automatic setup (feed detection + test) is running. */
  setupRunning: z.boolean(),
});
export type SourceDto = z.infer<typeof SourceDto>;

/** Step 1 (editor): name + address. The developer is notified to build the trigger. */
export const CreateSourceInput = z.object({
  name: z.string().trim().min(2, 'שם קצר מדי').max(80),
  baseUrl: HttpUrl,
  defaultCategory: CategorySlugField.nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  region: z.enum(SOURCE_REGIONS).default('local'),
});

/** Several sites at once (one link per site); each gets an automatic setup attempt. */
export const BulkSourcesInput = z.object({
  urls: z.array(HttpUrl).min(1, 'הוסיפו לפחות קישור אחד').max(50, 'עד 50 אתרים בבת אחת'),
  defaultCategory: CategorySlugField.nullable().optional(),
  region: z.enum(SOURCE_REGIONS).default('local'),
});
export const BulkSourcesResult = z.object({
  created: z.array(z.object({ id, baseUrl: z.string() })),
  skipped: z.array(z.object({ url: z.string(), reason: z.string() })),
});

/** Step 2 (developer): the trigger configuration. */
export const ConfigureSourceInput = z.object({
  method: z.enum(SCRAPE_METHODS),
  listUrls: z.array(HttpUrl).min(1, 'צריך לפחות כתובת אחת').max(10),
  selectorConfig: SelectorConfig,
  defaultCategory: CategorySlugField.nullable(),
  scrapeIntervalMin: z.number().int().min(5).max(24 * 60).default(30),
  devNotes: z.string().trim().max(2000).nullable().optional(),
});
export type ConfigureSourceInput = z.infer<typeof ConfigureSourceInput>;

export const SourceTestResult = z.object({
  ok: z.boolean(),
  items: z.array(
    z.object({ url: z.string(), title: z.string(), intro: z.string().nullable(), imageUrl: z.string().nullable(), publishedAt: iso.nullable(), category: z.string().nullable() }),
  ),
  article: z.object({ url: z.string(), title: z.string(), intro: z.string().nullable(), bodyText: z.string(), imageUrl: z.string().nullable() }).nullable(),
  errors: z.array(z.string()),
  /** Problems that don't block approval (e.g. a paywalled body: the feed summary is used). */
  warnings: z.array(z.string()),
});
export type SourceTestResult = z.infer<typeof SourceTestResult>;

// ---------------------------------------------------------------------------
// Discovery runs
// ---------------------------------------------------------------------------
export const RunDto = z.object({
  id,
  trigger: z.enum(['manual', 'schedule']),
  region: z.enum(SOURCE_REGIONS),
  status: z.enum(RUN_STATUSES),
  triggeredBy: z.string().nullable(),
  startedAt: iso.nullable(),
  finishedAt: iso.nullable(),
  itemsFound: z.number().int(),
  itemsNew: z.number().int(),
  createdAt: iso,
  sources: z.array(
    z.object({ id, name: z.string(), status: z.enum(RUN_STATUSES), itemsFound: z.number().int(), itemsNew: z.number().int(), error: z.string().nullable() }),
  ),
});
export type RunDto = z.infer<typeof RunDto>;

export const RunItemDto = z.object({
  id,
  url: z.string(),
  title: z.string(),
  intro: z.string().nullable(),
  imageUrl: z.string().nullable(),
  publishedAt: iso.nullable(),
  source: z.object({ id: z.string().nullable(), name: z.string() }),
  category: z.string().nullable(),
  status: z.enum(['new', 'in_draft', 'ignored']),
  origin: z.enum(['found', 'pulled']),
  /** Foreign articles: the language, and the Hebrew headline and intro (null until translated). */
  language: z.string().nullable(),
  titleHe: z.string().nullable(),
  introHe: z.string().nullable(),
});
export type RunItemDto = z.infer<typeof RunItemDto>;

export const RunDetail = z.object({ run: RunDto, isLatest: z.boolean(), items: z.array(RunItemDto) });
export type RunDetail = z.infer<typeof RunDetail>;

export const SaveSelectionInput = z.object({
  itemIds: z.array(id).min(1, 'לא נבחרו כתבות').max(60, 'אפשר לבחור עד 60 כתבות בבת אחת'),
  mode: z.enum(['magazine', 'single']).default('magazine'),
  title: z.string().trim().min(1).max(120).optional(),
  colorLabel: z.enum(DRAFT_COLORS).optional(),
});
export const SaveSelectionResult = z.object({ magazineId: id.nullable(), draftIds: z.array(id) });

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
export const MediaDto = z.object({
  id,
  url: z.string(),
  thumbUrl: z.string(),
  /** Vertical 1080x1920 crop for stories */
  storyUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  alt: z.string().nullable(),
  credit: z.string().nullable(),
  isAiGenerated: z.boolean(),
  focalX: z.number(),
  focalY: z.number(),
});
export type MediaDto = z.infer<typeof MediaDto>;

export const UpdateMediaInput = z.object({
  alt: z.string().trim().max(300).nullable().optional(),
  credit: z.string().trim().max(200).nullable().optional(),
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// Manual entry
// ---------------------------------------------------------------------------
export const ManualUrlInput = z.object({
  url: HttpUrl,
  colorLabel: z.enum(DRAFT_COLORS).optional(),
  magazineId: id.optional(),
});

export const ManualWriteInput = z.object({
  title: z.string().trim().min(2, 'כותרת קצרה מדי').max(200),
  subtitle: z.string().trim().max(400).default(''),
  /** Paragraphs separated by blank lines; "## " starts a sub-heading. */
  body: z.string().trim().min(20, 'הכתבה קצרה מדי').max(60_000),
  category: CategorySlugField,
  heroMediaId: id.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  colorLabel: z.enum(DRAFT_COLORS).optional(),
  magazineId: id.optional(),
});

// ---------------------------------------------------------------------------
// Saved edits: magazines and drafts
// ---------------------------------------------------------------------------
export const DraftSummary = z.object({
  id,
  title: z.string(),
  status: z.enum(DRAFT_STATUSES),
  origin: z.enum(DRAFT_ORIGINS),
  colorLabel: z.enum(DRAFT_COLORS).nullable(),
  category: z.string().nullable(),
  placement: z.enum(PLACEMENTS),
  sourceName: z.string().nullable(),
  thumbUrl: z.string().nullable(),
  magazine: z.object({ id, title: z.string() }).nullable(),
  position: z.number().int(),
  updatedAt: iso,
  updatedBy: z.string().nullable(),
});
export type DraftSummary = z.infer<typeof DraftSummary>;

export const MagazineSummary = z.object({
  id,
  title: z.string(),
  status: z.enum(MAGAZINE_STATUSES),
  createdBy: z.string(),
  createdAt: iso,
  updatedAt: iso,
  publishedAt: iso.nullable(),
  counts: z.object({ total: z.number().int(), ready: z.number().int(), skipped: z.number().int(), published: z.number().int(), working: z.number().int() }),
  thumbs: z.array(z.string()),
});
export type MagazineSummary = z.infer<typeof MagazineSummary>;

export const MagazineDetail = MagazineSummary.extend({ drafts: z.array(DraftSummary) });
export type MagazineDetail = z.infer<typeof MagazineDetail>;

export const SavedEdits = z.object({ magazines: z.array(MagazineSummary), singles: z.array(DraftSummary) });
export type SavedEdits = z.infer<typeof SavedEdits>;

export const JobRef = z.object({ id, kind: z.string(), status: z.enum(JOB_STATUSES), error: z.string().nullable() });
export type JobRef = z.infer<typeof JobRef>;

export const DraftDetail = z.object({
  id,
  version: z.number().int(),
  status: z.enum(DRAFT_STATUSES),
  origin: z.enum(DRAFT_ORIGINS),
  colorLabel: z.enum(DRAFT_COLORS).nullable(),
  title: z.string(),
  subtitle: z.string(),
  /** Sanitized ProseMirror JSON (see doc.ts) */
  bodyDoc: z.unknown(),
  category: z.string().nullable(),
  suggestedCategory: z.string().nullable(),
  placement: z.enum(PLACEMENTS),
  tags: z.array(z.string()),
  authorId: z.string().nullable(),
  sendPush: z.boolean(),
  /** The writer's disclosure of interests, printed at the end of the article. */
  disclosure: z.string(),
  hero: MediaDto.nullable(),
  original: z
    .object({
      title: z.string(),
      intro: z.string().nullable(),
      bodyText: z.string().nullable(),
      imageUrl: z.string().nullable(),
      url: z.string(),
      sourceName: z.string(),
      publishedAt: iso.nullable(),
      /** A foreign original: its language and the Hebrew translation (null while it is being translated). */
      language: z.string().nullable(),
      translation: z.object({ title: z.string(), intro: z.string().nullable(), bodyText: z.string().nullable() }).nullable(),
    })
    .nullable(),
  hasAiBaseline: z.boolean(),
  textFinalizedAt: iso.nullable(),
  skipReason: z.string().nullable(),
  publishedArticle: z.object({ id: z.number().int(), slug: z.string() }).nullable(),
  magazine: z.object({ id, title: z.string() }).nullable(),
  nav: z.object({ index: z.number().int(), total: z.number().int(), prevId: id.nullable(), nextId: id.nullable() }).nullable(),
  activeJob: JobRef.nullable(),
  updatedAt: iso,
  updatedBy: z.string().nullable(),
});
export type DraftDetail = z.infer<typeof DraftDetail>;

export const AutosaveInput = z.object({
  version: z.number().int().min(1),
  title: z.string().max(200),
  subtitle: z.string().max(400),
  bodyDoc: z.unknown(),
  /** A deliberate save ("save and continue"): also stored as a checkpoint revision. */
  checkpoint: z.boolean().default(false),
});
export const AutosaveResult = z.object({ version: z.number().int(), savedAt: iso });

export const DraftMetaInput = z.object({
  category: CategorySlugField.nullable().optional(),
  placement: z.enum(PLACEMENTS).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  authorId: id.nullable().optional(),
  colorLabel: z.enum(DRAFT_COLORS).nullable().optional(),
  sendPush: z.boolean().optional(),
  heroMediaId: id.nullable().optional(),
  disclosure: z.string().trim().max(300).optional(),
});

/** How much of the draft repeats the original's wording (copyright check before publishing). */
export const SimilarityDto = z.object({
  /** Share of the draft's 6-word sequences that also appear in the original, 0..1. */
  ratio: z.number(),
  level: z.enum(['ok', 'warn', 'high']),
  /** Longest passages copied word for word (8 words or more), longest first. */
  passages: z.array(z.string()),
});
export type SimilarityDto = z.infer<typeof SimilarityDto>;

export const RefineInput = z.object({
  instruction: z.string().trim().min(2, 'כתבו מה לשנות').max(2000),
  /** Text the editor selected on the canvas, when the request is about one passage. */
  selection: z.string().max(4000).optional(),
});

export const ChatMessageDto = z.object({ id: z.number().int(), role: z.enum(['user', 'assistant']), content: z.string(), createdAt: iso });
export type ChatMessageDto = z.infer<typeof ChatMessageDto>;

export const ImageBatchDto = z.object({
  id,
  prompt: z.string(),
  /** Who wrote the description: the visual agent or the editor (null: before the agent, the writer AI's English prompt). */
  promptBy: z.enum(PROMPT_AUTHORS).nullable(),
  createdAt: iso,
  images: z.array(MediaDto),
  /** working: the AI is still drawing; failed: nothing came back (error says why, for the editor). */
  status: z.enum(['working', 'done', 'failed']),
  error: z.string().nullable(),
  /** Something the editor should know about a batch that did work. */
  note: z.string().nullable(),
});
export type ImageBatchDto = z.infer<typeof ImageBatchDto>;

/** The article's image options: quick drafts to choose from; the chosen one is redrawn at full quality. */
export const DraftImagesDto = z.object({
  batches: z.array(ImageBatchDto),
  /** Drafts being drawn. */
  activeJob: JobRef.nullable(),
  heroId: id.nullable(),
  /** The option shown as chosen: the main image, or the draft it was redrawn from. */
  chosenId: id.nullable(),
  /** The chosen draft while its full-quality version is being made (or that failed); null once it is done. */
  upgrade: z.object({ status: z.enum(['working', 'failed']), error: z.string().nullable() }).nullable(),
});
export type DraftImagesDto = z.infer<typeof DraftImagesDto>;

export const GenerateImagesInput = z.object({
  prompt: z.string().trim().max(1000).optional(),
  /** Let the generator look at the original's photo (as inspiration, never copied). */
  useSourceImage: z.boolean().optional(),
});

export const SkipInput = z.object({ reason: z.string().trim().max(300).optional() });

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------
export const SocialPostDto = z.object({
  accountId: id,
  platform: z.enum(SOCIAL_PLATFORMS),
  displayName: z.string(),
  linkInFirstComment: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(SOCIAL_POST_STATUSES),
  lastError: z.string().nullable(),
  postedAt: iso.nullable(),
});

export const SocialPackageDto = z.object({
  headline: z.string(),
  caption: z.string(),
  image: MediaDto.nullable(),
  isStale: z.boolean(),
  approvedAt: iso.nullable(),
  version: z.number().int(),
  posts: z.array(SocialPostDto),
  batches: z.array(ImageBatchDto),
  activeJob: JobRef.nullable(),
});
export type SocialPackageDto = z.infer<typeof SocialPackageDto>;

export const UpdateSocialInput = z.object({
  version: z.number().int(),
  headline: z.string().trim().max(120),
  caption: z.string().trim().max(600),
  imageMediaId: id.nullable().optional(),
});

export const GenerateSocialInput = z.object({
  what: z.enum(['text', 'image', 'both']),
  instruction: z.string().trim().max(1000).optional(),
});

export const SocialTargetsInput = z.object({ accounts: z.array(z.object({ accountId: id, enabled: z.boolean() })).max(20) });

export const SocialAccountDto = z.object({
  id,
  platform: z.enum(SOCIAL_PLATFORMS),
  displayName: z.string(),
  externalId: z.string(),
  linkInFirstComment: z.boolean(),
  isActive: z.boolean(),
  /** Whether the server has credentials for it (otherwise posts are prepared, not sent). */
  connected: z.boolean(),
});
export type SocialAccountDto = z.infer<typeof SocialAccountDto>;

/**
 * Why a value can't be the account's ID on that network (null when it can). The APIs take the
 * numeric Page / IG User ID, never the @username, and a Telegram channel by @name or -100… ID.
 */
export function socialAccountIdProblem(platform: SocialPlatform, externalId: string): string | null {
  const v = externalId.trim();
  if (platform === 'facebook' && !/^\d{5,30}$/.test(v)) {
    return 'מזהה עמוד פייסבוק הוא מספר בלבד (Page ID), למשל 1424305327424928. הוא מופיע מתחת לשם העמוד כשנותנים לאפליקציה גישה, וב-Graph API Explorer.';
  }
  if (platform === 'instagram' && !/^\d{5,30}$/.test(v)) {
    return 'מזהה אינסטגרם הוא מספר (IG User ID), לא שם המשתמש. מוצאים אותו ב-Graph API Explorer, בשדה instagram_business_account של העמוד.';
  }
  if (platform === 'telegram' && !/^(@[A-Za-z][A-Za-z0-9_]{4,31}|-100\d{5,20})$/.test(v)) {
    return 'בטלגרם: @ ושם הערוץ (למשל @b4news_il), או לערוץ פרטי המספר שמתחיל ב-‎-100.';
  }
  return null;
}

export const CreateSocialAccountInput = z
  .object({
    platform: z.enum(SOCIAL_PLATFORMS),
    displayName: z.string().trim().min(2).max(80),
    externalId: z.string().trim().min(1).max(200),
    /** Name of the server secret holding the token: SOCIAL_SECRET_<secretRef> */
    secretRef: z.string().trim().regex(/^[A-Z0-9_]{2,60}$/, 'אותיות גדולות באנגלית, ספרות וקו תחתון'),
  })
  .superRefine((v, ctx) => {
    const problem = socialAccountIdProblem(v.platform, v.externalId);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalId'], message: problem });
  });

/** Turn an account on or off, or correct its ID (the token stays). */
export const UpdateSocialAccountInput = z.object({
  isActive: z.boolean().optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Preview and publishing
// ---------------------------------------------------------------------------
export const PreviewItem = z.object({
  draft: DraftSummary,
  subtitle: z.string(),
  excerpt: z.string(),
  heroUrl: z.string().nullable(),
  tags: z.array(z.string()),
  editorName: z.string().nullable(),
  social: z.object({ ready: z.boolean(), platforms: z.array(z.enum(SOCIAL_PLATFORMS)) }),
  /** Why it can't be published yet (empty = ready). */
  problems: z.array(z.string()),
  /** Worth a look before publishing, but not blocking (e.g. wording close to the original). */
  warnings: z.array(z.string()),
});
export type PreviewItem = z.infer<typeof PreviewItem>;

export const PublishPreview = z.object({
  publishDate: iso,
  editorName: z.string(),
  items: z.array(PreviewItem),
  readyCount: z.number().int(),
  skippedCount: z.number().int(),
});
export type PublishPreview = z.infer<typeof PublishPreview>;

export const PublishInput = z.object({ idempotencyKey: z.string().trim().min(8).max(100) });

export const PublishJobDto = z.object({
  id,
  status: z.enum(JOB_STATUSES),
  steps: z.record(z.string()),
  error: z.string().nullable(),
  createdAt: iso,
  finishedAt: iso.nullable(),
});
export type PublishJobDto = z.infer<typeof PublishJobDto>;

// ---------------------------------------------------------------------------
// Published articles ("כתבות באתר"): edit in place, remove, restore, delete
// ---------------------------------------------------------------------------
/** "published": on the site (also scheduled ones); "unpublished": removed, can be put back. */
export const ARTICLE_LIST_STATUSES = ['published', 'unpublished'] as const;

export const ArticleListQuery = z.object({
  status: z.enum(ARTICLE_LIST_STATUSES).default('published'),
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORY_SLUGS).optional(),
  cursor: z.string().max(200).optional(),
});

export const PublishedArticleDto = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(['published', 'scheduled', 'unpublished']),
  category: z.string(),
  publishedAt: iso,
  updatedAt: iso,
  thumbUrl: z.string().nullable(),
  author: z.string().nullable(),
  commentCount: z.number().int(),
  onHomepage: z.enum(['main', 'trending']).nullable(),
  /** The draft that edits this article (null until it is first opened for editing). */
  draftId: id.nullable(),
  /** Changes are being made in the editor and are not on the site yet. */
  editing: z.boolean(),
});
export type PublishedArticleDto = z.infer<typeof PublishedArticleDto>;

export const PublishedArticleList = z.object({ items: z.array(PublishedArticleDto), nextCursor: z.string().nullable() });
export type PublishedArticleList = z.infer<typeof PublishedArticleList>;

// ---------------------------------------------------------------------------
// Learning loop
// ---------------------------------------------------------------------------
export const StyleProfileDto = z.object({
  id: z.number().int(),
  rules: z.string(),
  feedbackCount: z.number().int(),
  isActive: z.boolean(),
  createdAt: iso,
  approvedBy: z.string().nullable(),
});
export type StyleProfileDto = z.infer<typeof StyleProfileDto>;

export const FeedbackDto = z.object({
  id,
  articleTitle: z.string().nullable(),
  category: z.string().nullable(),
  editorName: z.string().nullable(),
  editRatio: z.number(),
  status: z.enum(['pending', 'distilled', 'excluded']),
  createdAt: iso,
});

export const LearningOverview = z.object({
  pending: z.number().int(),
  distilled: z.number().int(),
  averageEditRatio: z.number().nullable(),
  recent: z.array(FeedbackDto),
  profiles: z.array(StyleProfileDto),
  activeJob: JobRef.nullable(),
});
export type LearningOverview = z.infer<typeof LearningOverview>;

// ---------------------------------------------------------------------------
// Dashboard and staff
// ---------------------------------------------------------------------------
export const DashboardDto = z.object({
  drafts: z.object({ working: z.number().int(), ready: z.number().int(), aiFailed: z.number().int() }),
  magazinesOpen: z.number().int(),
  publishedToday: z.number().int(),
  lastRun: RunDto.nullable(),
  sources: z.object({ active: z.number().int(), waitingForDeveloper: z.number().int(), broken: z.number().int() }),
  comments: z.object({ toReview: z.number().int(), reported: z.number().int() }),
  /** Content-removal requests not decided yet. */
  takedowns: z.object({ open: z.number().int(), overdue: z.number().int() }),
  failedJobs: z.number().int(),
  ai: z.object({ text: z.string(), image: z.string(), live: z.boolean() }),
});
export type DashboardDto = z.infer<typeof DashboardDto>;

export const StaffUserDto = z.object({
  id,
  email: z.string(),
  fullName: z.string(),
  role: z.enum(STAFF_ROLES),
  isActive: z.boolean(),
  lastLoginAt: iso.nullable(),
  createdAt: iso,
  /** Signs in with a code from an authenticator app as well. */
  twoFactor: z.boolean(),
});
export type StaffUserDto = z.infer<typeof StaffUserDto>;

export const CreateStaffInput = z.object({
  email: z.string().trim().toLowerCase().email('כתובת המייל לא תקינה').max(254),
  fullName: z.string().trim().min(2).max(80),
  role: z.enum(STAFF_ROLES),
});

export const UpdateStaffInput = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  isActive: z.boolean().optional(),
  fullName: z.string().trim().min(2).max(80).optional(),
});

export const ChangePasswordInput = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(12, 'לפחות 12 תווים').max(200),
});

export const AuthorDto = z.object({ id, displayName: z.string(), title: z.string().nullable() });
export type AuthorDto = z.infer<typeof AuthorDto>;

// ---------------------------------------------------------------------------
// Audience: registered readers (comments) and newsletter subscribers
// ---------------------------------------------------------------------------
export const READER_FILTERS = ['all', 'active', 'banned'] as const;
export const ReaderListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(READER_FILTERS).default('all'),
  cursor: z.string().max(200).optional(),
});

export const AdminReaderDto = z.object({
  id,
  email: z.string(),
  displayName: z.string(),
  status: z.enum(['active', 'banned']),
  bannedReason: z.string().nullable(),
  /** Accepted the current terms version. */
  termsAccepted: z.boolean(),
  createdAt: iso,
  lastLoginAt: iso.nullable(),
  comments: z.number().int(),
  hiddenComments: z.number().int(),
  /** Signed in on a device right now (an unexpired session). */
  signedIn: z.boolean(),
});
export type AdminReaderDto = z.infer<typeof AdminReaderDto>;
export const ReaderList = z.object({ items: z.array(AdminReaderDto), nextCursor: z.string().nullable() });
export type ReaderList = z.infer<typeof ReaderList>;

export const SUBSCRIBER_STATUSES = ['active', 'pending', 'unsubscribed'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];
export const SubscriberListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...SUBSCRIBER_STATUSES, 'all']).default('active'),
  cursor: z.string().max(200).optional(),
});

export const SubscriberDto = z.object({
  id,
  email: z.string(),
  status: z.enum(SUBSCRIBER_STATUSES),
  createdAt: iso,
  confirmedAt: iso.nullable(),
  unsubscribedAt: iso.nullable(),
});
export type SubscriberDto = z.infer<typeof SubscriberDto>;
export const SubscriberList = z.object({ items: z.array(SubscriberDto), nextCursor: z.string().nullable() });
export type SubscriberList = z.infer<typeof SubscriberList>;

/** One reader's comments, for the CMS (every status). */
export const AdminReaderComment = z.object({
  id,
  body: z.string(),
  status: z.enum(['visible', 'hidden', 'removed']),
  likeCount: z.number().int(),
  picked: z.boolean(),
  isReply: z.boolean(),
  createdAt: iso,
  article: z.object({ id: z.number().int(), slug: z.string(), title: z.string() }),
});
export type AdminReaderComment = z.infer<typeof AdminReaderComment>;

export const PickCommentInput = z.object({ picked: z.boolean() });

/** What the readers' and subscribers' flows need to work on this environment. */
export const AUDIENCE_SETUP = ['mail', 'sender', 'company', 'https'] as const;
export type AudienceSetupKey = (typeof AUDIENCE_SETUP)[number];

export const AudienceOverview = z.object({
  readers: z.object({ total: z.number().int(), active30d: z.number().int(), newThisWeek: z.number().int(), banned: z.number().int() }),
  subscribers: z.object({ active: z.number().int(), pending: z.number().int(), unsubscribed: z.number().int() }),
  /** App installs that get breaking-news notifications, by platform. */
  devices: z.object({ ios: z.number().int(), android: z.number().int(), web: z.number().int() }),
  setup: z.array(z.object({ key: z.enum(AUDIENCE_SETUP), ok: z.boolean() })),
});
export type AudienceOverview = z.infer<typeof AudienceOverview>;
