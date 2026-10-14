// B4 NEW'S database schema (PostgreSQL 16+). Column names are snake_case in the
// database (drizzle `casing: 'snake_case'`) and camelCase in TypeScript.
//
// Sections: people & sessions · taxonomy · media · sources & discovery ·
// editorial workflow · published content · comments · social · learning loop · operations
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { COMMENT_STATUSES, REPORT_REASONS, STAFF_ROLES, TAKEDOWN_KINDS, TAKEDOWN_STATUSES, type DigestPrefs, type ReelIdea, type ReelPlan, type SelectorConfig, type VisualFeedbackDetail } from '@b4/shared';

const tstz = () => timestamp({ withTimezone: true });
const createdAt = () => tstz().notNull().defaultNow();
const updatedAt = () =>
  tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRole = pgEnum('user_role', STAFF_ROLES);
export const readerStatus = pgEnum('reader_status', ['active', 'banned']);
export const sessionKind = pgEnum('session_kind', ['staff', 'reader']);
export const categoryKind = pgEnum('category_kind', ['topic', 'column']);
export const sourceStatus = pgEnum('source_status', ['pending_dev', 'in_development', 'active', 'paused', 'broken', 'archived']);
export const scrapeMethod = pgEnum('scrape_method', ['rss', 'sitemap', 'html', 'html_js']);
export const runStatus = pgEnum('run_status', ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']);
export const runTrigger = pgEnum('run_trigger', ['manual', 'schedule']);
export const runItemOrigin = pgEnum('run_item_origin', ['found', 'pulled']);
export const scrapedItemStatus = pgEnum('scraped_item_status', ['new', 'in_draft', 'ignored']);
export const magazineStatus = pgEnum('magazine_status', ['draft', 'editing', 'ready', 'publishing', 'published', 'partially_failed', 'archived']);
export const draftOrigin = pgEnum('draft_origin', ['scraped', 'manual_url', 'manual_write']);
export const draftStatus = pgEnum('draft_status', ['queued_ai', 'ai_processing', 'ai_failed', 'editing', 'text_final', 'ready', 'skipped', 'published']);
export const draftColor = pgEnum('draft_color', ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']);
export const homepagePlacement = pgEnum('homepage_placement', ['main', 'trending', 'none']);
export const homepageZone = pgEnum('homepage_zone', ['main', 'trending']);
export const revisionSource = pgEnum('revision_source', ['ai_initial', 'ai_refine', 'human_autosave', 'human_checkpoint', 'restore']);
/** ai_preview: a quick, low-resolution AI draft to choose from; the chosen one is redrawn as an ai_article. */
export const mediaKind = pgEnum('media_kind', ['upload', 'scraped_original', 'ai_article', 'ai_social', 'ai_preview']);
export const imagePurpose = pgEnum('image_purpose', ['article', 'social']);
export const aiJobType = pgEnum('ai_job_type', [
  'rewrite',
  'refine',
  'article_images',
  'social_caption',
  'social_image',
  'style_distill',
  'classify',
  'translate',
  'agent_turn',
  'social_video',
  'visual_prompt',
  'visual_learning',
  'legal_review',
]);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const chatRole = pgEnum('chat_role', ['user', 'assistant']);
export const articleStatus = pgEnum('article_status', ['published', 'scheduled', 'unpublished']);
export const commentStatus = pgEnum('comment_status', COMMENT_STATUSES);
export const reportReason = pgEnum('report_reason', REPORT_REASONS);
export const sourceRegion = pgEnum('source_region', ['local', 'international']);
export const socialPlatform = pgEnum('social_platform', ['facebook', 'instagram', 'telegram', 'whatsapp', 'x', 'tiktok']);
export const socialFormat = pgEnum('social_format', ['feed', 'story', 'message', 'reel']);
export const socialPostStatus = pgEnum('social_post_status', ['draft', 'queued', 'posting', 'posted', 'comment_failed', 'failed', 'skipped']);
export const feedbackStatus = pgEnum('feedback_status', ['pending', 'distilled', 'excluded']);
export const devicePlatform = pgEnum('device_platform', ['ios', 'android', 'web']);
export const consentSubject = pgEnum('consent_subject', ['reader', 'subscriber', 'visitor']);
export const consentChannel = pgEnum('consent_channel', ['web', 'app']);
export const takedownKind = pgEnum('takedown_kind', TAKEDOWN_KINDS);
export const takedownStatus = pgEnum('takedown_status', TAKEDOWN_STATUSES);

// ---------------------------------------------------------------------------
// People & sessions
// ---------------------------------------------------------------------------
/** Newsroom staff (CMS). Emails are stored lower-cased. */
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  fullName: text().notNull(),
  role: userRole().notNull().default('editor'),
  passwordHash: text(),
  isActive: boolean().notNull().default(true),
  lastLoginAt: tstz(),
  /** Two-step sign-in: the authenticator app's secret, encrypted with SECRETS_KEY (null = off). */
  totpSecret: text(),
  /** A secret being set up, until the first code from the app confirms it. */
  totpPendingSecret: text(),
  totpEnabledAt: tstz(),
  /** The last 30-second step a code was accepted for (a code works once). */
  totpLastStep: integer(),
  /** One-time recovery codes for a lost phone (keyed hashes). */
  totpRecoveryHashes: text().array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** After the password, before the session: waits for the authenticator code (id = sha256 of the token). */
export const staffLoginChallenges = pgTable('staff_login_challenges', {
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  attempts: smallint().notNull().default(0),
  expiresAt: tstz().notNull(),
  createdAt: createdAt(),
});

/** Registered readers (comments). Sign-in is by one-time email code; no passwords. */
export const readers = pgTable('readers', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  displayName: text().notNull(),
  status: readerStatus().notNull().default('active'),
  bannedReason: text(),
  /** The terms version this reader last accepted (every acceptance is also in `consents`). */
  termsVersion: text(),
  termsAcceptedAt: tstz(),
  /** Replies, likes and the editors' pick: by mail (gathered, at most once an hour) and in the app. */
  notifyEmail: boolean().notNull().default(true),
  notifyPush: boolean().notNull().default(true),
  /** "העיתון שלי" for a signed-in reader: topics (also their feed), time and how (null: not set up). */
  digest: jsonb().$type<DigestPrefs>(),
  lastDigestAt: tstz(),
  createdAt: createdAt(),
  lastLoginAt: tstz(),
});

/** One-time sign-in codes. Only a hash of the code is stored. */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    codeHash: text().notNull(),
    attempts: smallint().notNull().default(0),
    expiresAt: tstz().notNull(),
    consumedAt: tstz(),
    ipHash: text(),
    /** The "sign in with one click" link mailed with the code (a keyed hash; the token is only in the mail). */
    linkTokenHash: text().unique(),
    /** The reader ticked the terms box when asking for the code (the link signs in without asking again). */
    termsAccepted: boolean().notNull().default(false),
    /** The page to return to after signing in from the link (a path on the site). */
    returnTo: text(),
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_email_idx').on(t.email, t.createdAt)],
);

/** Server-side sessions for staff and readers. `id` is sha256(token); the token itself is never stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(),
    kind: sessionKind().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    readerId: uuid().references(() => readers.id, { onDelete: 'cascade' }),
    userAgent: text(),
    createdAt: createdAt(),
    lastSeenAt: tstz().notNull().defaultNow(),
    expiresAt: tstz().notNull(),
  },
  (t) => [
    check(
      'sessions_one_subject',
      sql`(${t.kind} = 'staff' and ${t.userId} is not null and ${t.readerId} is null)
       or (${t.kind} = 'reader' and ${t.readerId} is not null and ${t.userId} is null)`,
    ),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------
export const categories = pgTable('categories', {
  id: smallint().primaryKey().generatedAlwaysAsIdentity(),
  parentId: smallint().references((): AnyPgColumn => categories.id),
  slug: text().notNull().unique(),
  name: text().notNull(),
  kind: categoryKind().notNull().default('topic'),
  sortOrder: smallint().notNull().default(0),
  isActive: boolean().notNull().default(true),
});

export const tags = pgTable('tags', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slug: text().notNull().unique(),
  name: text().notNull(),
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
export const mediaAssets = pgTable('media_assets', {
  id: uuid().primaryKey().defaultRandom(),
  kind: mediaKind().notNull(),
  storageKey: text().notNull().unique(),
  originalUrl: text(),
  mimeType: text().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  bytes: integer().notNull(),
  /** Site renditions: { hero, card, thumb, og, feed, story } -> storage key */
  variants: jsonb().$type<Record<string, string>>().notNull().default({}),
  focalX: real().notNull().default(0.5),
  focalY: real().notNull().default(0.5),
  altText: text(),
  credit: text(),
  isAiGenerated: boolean().notNull().default(false),
  aiPrompt: text(),
  generationBatchId: uuid().references((): AnyPgColumn => imageBatches.id, { onDelete: 'set null' }),
  /** A final AI image: the draft (ai_preview) it was redrawn from at full quality. */
  derivedFromId: uuid().references((): AnyPgColumn => mediaAssets.id, { onDelete: 'set null' }),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

/** Public bylines. Staff writers link to a user; outside columnists usually don't. */
export const authors = pgTable('authors', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
  slug: text().notNull().unique(),
  displayName: text().notNull(),
  title: text(),
  bio: text(),
  avatarMediaId: uuid().references(() => mediaAssets.id, { onDelete: 'set null' }),
  isColumnist: boolean().notNull().default(false),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Sources & discovery
// ---------------------------------------------------------------------------
/** `selectorConfig` is written by the developer when a source is set up (SelectorConfig in @b4/shared). */
export const sources = pgTable(
  'sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    baseUrl: text().notNull().unique(),
    listUrls: text().array().notNull().default(sql`'{}'::text[]`),
    method: scrapeMethod(),
    selectorConfig: jsonb().$type<SelectorConfig>(),
    defaultCategoryId: smallint().references(() => categories.id),
    /** Israeli sites and sites from abroad are found and scanned separately. */
    region: sourceRegion().notNull().default('local'),
    /** The site's language (ISO 639-1, from <html lang>); non-Hebrew articles are translated. */
    language: text(),
    status: sourceStatus().notNull().default('pending_dev'),
    scrapeIntervalMin: integer().notNull().default(30),
    /** Delta fetch: newest published_at committed by the last successful run. */
    watermarkPublishedAt: tstz(),
    lastSuccessAt: tstz(),
    lastTestPassedAt: tstz(),
    consecutiveFailures: integer().notNull().default(0),
    devNotes: text(),
    requestedBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    approvedAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'active_source_is_configured',
      sql`${t.status} <> 'active' or (${t.method} is not null and ${t.selectorConfig} is not null and ${t.approvedAt} is not null)`,
    ),
  ],
);

export const scrapeRuns = pgTable(
  'scrape_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    trigger: runTrigger().notNull(),
    /** Which sites this run scans: Israeli or international. */
    region: sourceRegion().notNull().default('local'),
    triggeredBy: uuid().references(() => users.id),
    status: runStatus().notNull().default('queued'),
    startedAt: tstz(),
    finishedAt: tstz(),
    itemsFound: integer().notNull().default(0),
    itemsNew: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('scrape_runs_created_idx').on(t.createdAt.desc())],
);

/** Per-source result of a run. The watermark moves only when this row succeeds. */
export const scrapeRunSources = pgTable(
  'scrape_run_sources',
  {
    runId: uuid()
      .notNull()
      .references(() => scrapeRuns.id, { onDelete: 'cascade' }),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id),
    status: runStatus().notNull().default('queued'),
    since: tstz(),
    newWatermark: tstz(),
    itemsFound: integer().notNull().default(0),
    itemsNew: integer().notNull().default(0),
    error: text(),
    durationMs: integer(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.sourceId] })],
);

export const scrapedItems = pgTable(
  'scraped_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** null = fetched through Manual Entry by URL */
    sourceId: uuid().references(() => sources.id),
    firstRunId: uuid().references(() => scrapeRuns.id),
    url: text().notNull(),
    /** sha256(canonical URL), hex: the dedup key */
    urlHash: text().notNull().unique(),
    /** sha256(normalized body), hex: the same story under a second URL */
    contentHash: text(),
    title: text().notNull(),
    intro: text(),
    bodyText: text(),
    imageUrl: text(),
    thumbnailMediaId: uuid().references(() => mediaAssets.id),
    publishedAt: tstz(),
    categoryId: smallint().references(() => categories.id),
    status: scrapedItemStatus().notNull().default('new'),
    /** ISO 639-1; null = Hebrew / unknown (no translation needed). */
    language: text(),
    /** Hebrew translation of a foreign article: headline and intro after discovery, body when it is edited. */
    titleHe: text(),
    introHe: text(),
    bodyHe: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('scraped_items_source_idx').on(t.sourceId, t.publishedAt.desc()),
    index('scraped_items_category_idx').on(t.categoryId, t.publishedAt.desc()),
    index('scraped_items_content_idx').on(t.contentHash),
  ],
);

/** Which items a run shows: found by it, or pulled in from an older run. */
export const scrapeRunItems = pgTable(
  'scrape_run_items',
  {
    runId: uuid()
      .notNull()
      .references(() => scrapeRuns.id, { onDelete: 'cascade' }),
    itemId: uuid()
      .notNull()
      .references(() => scrapedItems.id, { onDelete: 'cascade' }),
    origin: runItemOrigin().notNull().default('found'),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.itemId] }), index('scrape_run_items_item_idx').on(t.itemId)],
);

/** Large raw payloads, kept out of the hot table. */
export const scrapedItemPayloads = pgTable('scraped_item_payloads', {
  itemId: uuid()
    .primaryKey()
    .references(() => scrapedItems.id, { onDelete: 'cascade' }),
  rawHtml: text(),
  raw: jsonb().notNull(),
});

// ---------------------------------------------------------------------------
// Editorial workflow
// ---------------------------------------------------------------------------
export const promptTemplates = pgTable(
  'prompt_templates',
  {
    key: text().notNull(),
    version: integer().notNull(),
    body: text().notNull(),
    isActive: boolean().notNull().default(false),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.key, t.version] })],
);

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    type: aiJobType().notNull(),
    draftId: uuid().references((): AnyPgColumn => articleDrafts.id, { onDelete: 'set null' }),
    status: jobStatus().notNull().default('queued'),
    provider: text().notNull(),
    model: text().notNull(),
    promptKey: text(),
    promptVersion: integer(),
    inputTokens: integer(),
    outputTokens: integer(),
    imageCount: integer(),
    costUsd: numeric({ precision: 10, scale: 4 }),
    latencyMs: integer(),
    error: text(),
    requestedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    finishedAt: tstz(),
  },
  (t) => [index('ai_jobs_created_idx').on(t.createdAt.desc()), index('ai_jobs_draft_idx').on(t.draftId)],
);

/** "Saved edits" of type magazine: a batch of articles edited together. */
export const magazines = pgTable(
  'magazines',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    status: magazineStatus().notNull().default('draft'),
    fromRunId: uuid().references(() => scrapeRuns.id),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    publishedAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('magazines_status_idx').on(t.status, t.updatedAt.desc())],
);

export const articleDrafts = pgTable(
  'article_drafts',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** null = a single saved article (not part of a magazine) */
    magazineId: uuid().references(() => magazines.id, { onDelete: 'set null' }),
    position: smallint().notNull().default(0),
    origin: draftOrigin().notNull(),
    /** The read-only original shown in the editor's left pane */
    scrapedItemId: uuid().references(() => scrapedItems.id),
    status: draftStatus().notNull().default('queued_ai'),
    /** Color label the editor gives a saved article */
    colorLabel: draftColor(),

    title: text().notNull().default(''),
    subtitle: text().notNull().default(''),
    bodyDoc: jsonb().notNull().default({ type: 'doc', content: [] }),
    bodyText: text().notNull().default(''),

    /** First full AI rewrite: the baseline the learning loop compares the final text against. */
    aiBaselineTitle: text(),
    aiBaselineText: text(),
    aiBaselineJobId: uuid().references(() => aiJobs.id),

    categoryId: smallint().references(() => categories.id),
    /** What the AI classified it as; the editor's choice goes in categoryId. */
    suggestedCategoryId: smallint().references(() => categories.id),
    /** Image prompt the AI wrote with the rewrite; the default brief for the image drafts. */
    imagePrompt: text(),
    placement: homepagePlacement().notNull().default('none'),
    authorId: uuid().references(() => authors.id),
    heroMediaId: uuid().references(() => mediaAssets.id),
    tagNames: text().array().notNull().default(sql`'{}'::text[]`),
    sendPush: boolean().notNull().default(false),
    /** The writer's disclosure of interests ("גילוי נאות"); empty = none. */
    disclosure: text().notNull().default(''),

    /** Optimistic lock for autosave */
    version: integer().notNull().default(1),
    lockedBy: uuid().references(() => users.id),
    lockExpiresAt: tstz(),
    textFinalizedAt: tstz(),
    skipReason: text(),
    publishedArticleId: bigint({ mode: 'number' }).references((): AnyPgColumn => articles.id),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    updatedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('article_drafts_magazine_idx').on(t.magazineId, t.position),
    index('article_drafts_status_idx').on(t.status, t.updatedAt.desc()),
    check('original_required', sql`${t.origin} = 'manual_write' or ${t.scrapedItemId} is not null`),
    check(
      'ready_means_complete',
      sql`${t.status} not in ('ready', 'published') or (${t.categoryId} is not null and ${t.heroMediaId} is not null and ${t.textFinalizedAt} is not null and ${t.title} <> '')`,
    ),
  ],
);

export const draftRevisions = pgTable(
  'draft_revisions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    draftId: uuid()
      .notNull()
      .references(() => articleDrafts.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    source: revisionSource().notNull(),
    title: text().notNull(),
    subtitle: text().notNull(),
    bodyDoc: jsonb().notNull(),
    bodyText: text().notNull(),
    aiJobId: uuid().references(() => aiJobs.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('draft_revisions_draft_idx').on(t.draftId, t.id.desc())],
);

/** One risk the legal review found, with the AI's safer wording and a person's decision. */
export type ReviewIssueRecord = {
  id: string;
  flag: string;
  where: string;
  quote: string;
  subject: string;
  why: string;
  advice: string;
  fix: { status: 'writing' | 'ready' | 'failed'; after: string; error: string | null } | null;
  decision: { action: string; reason: string; response: string; by: string; byId: string; at: string } | null;
};

/**
 * The legal review of a draft, run when its text is marked final: the risks found and the
 * decisions on them. Publishing waits until every risk is decided.
 */
export const draftReviews = pgTable('draft_reviews', {
  draftId: uuid()
    .primaryKey()
    .references(() => articleDrafts.id, { onDelete: 'cascade' }),
  /** checking | clear | flagged | failed (resolved and waived are worked out from the decisions) */
  status: text().notNull().default('checking'),
  issues: jsonb().$type<ReviewIssueRecord[]>().notNull().default([]),
  /** Why the check didn't finish, in Hebrew. */
  lastError: text(),
  checkedAt: tstz(),
  /** A person published without a finished check. */
  waivedBy: uuid().references(() => users.id),
  waivedAt: tstz(),
  waiveReason: text(),
  /** When the admins were emailed about this check. */
  notifiedAt: tstz(),
  version: integer().notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The "ask the AI again" chat beside the canvas. */
export const aiChatMessages = pgTable(
  'ai_chat_messages',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    draftId: uuid()
      .notNull()
      .references(() => articleDrafts.id, { onDelete: 'cascade' }),
    role: chatRole().notNull(),
    content: text().notNull(),
    selection: jsonb().$type<{ from: number; to: number; text: string }>(),
    revisionId: bigint({ mode: 'number' }).references(() => draftRevisions.id),
    aiJobId: uuid().references(() => aiJobs.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('ai_chat_messages_draft_idx').on(t.draftId, t.id)],
);

/** Each "generate" click = one batch of options (article: 3 quick drafts; story: 2 images). */
export const imageBatches = pgTable(
  'image_batches',
  {
    id: uuid().primaryKey().defaultRandom(),
    draftId: uuid()
      .notNull()
      .references(() => articleDrafts.id, { onDelete: 'cascade' }),
    purpose: imagePurpose().notNull(),
    prompt: text().notNull(),
    /** agent | editor: who wrote the description (null: before the visual agent). */
    promptBy: text(),
    aiJobId: uuid().references(() => aiJobs.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('image_batches_draft_idx').on(t.draftId, t.purpose, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Published content
// ---------------------------------------------------------------------------
export const articles = pgTable(
  'articles',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text().notNull().unique(),
    status: articleStatus().notNull().default('published'),
    title: text().notNull(),
    subtitle: text().notNull().default(''),
    bodyDoc: jsonb().notNull().default({}),
    /** Sanitized HTML rendered once at publish */
    bodyHtml: text().notNull(),
    excerpt: text().notNull(),
    categoryId: smallint()
      .notNull()
      .references(() => categories.id),
    authorId: uuid().references(() => authors.id),
    editorId: uuid().references(() => users.id),
    heroMediaId: uuid().references(() => mediaAssets.id),
    /** Attribution of the original report */
    sourceId: uuid().references(() => sources.id),
    sourceUrl: text(),
    seoTitle: text(),
    seoDescription: text(),
    readingMinutes: smallint().notNull().default(3),
    commentsEnabled: boolean().notNull().default(true),
    disclosure: text(),
    draftId: uuid()
      .unique()
      .references((): AnyPgColumn => articleDrafts.id),
    publishedAt: tstz().notNull().defaultNow(),
    updatedAt: updatedAt(),
    searchVector: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', title || ' ' || subtitle || ' ' || excerpt)`),
  },
  (t) => [
    index('articles_published_idx').on(t.status, t.publishedAt.desc()),
    index('articles_category_idx').on(t.categoryId, t.publishedAt.desc()),
    index('articles_search_idx').using('gin', t.searchVector),
  ],
);

export const articleTags = pgTable(
  'article_tags',
  {
    articleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    tagId: integer()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.tagId] }), index('article_tags_tag_idx').on(t.tagId)],
);

/** Homepage zones: exactly 7 "main" slots and up to 14 "trending" slots. */
export const homepageSlots = pgTable(
  'homepage_slots',
  {
    zone: homepageZone().notNull(),
    position: smallint().notNull(),
    articleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    pinned: boolean().notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.articleId] }),
    unique('homepage_slots_position_unique').on(t.zone, t.position),
    check(
      'homepage_slots_position_range',
      sql`(${t.zone} = 'main' and ${t.position} between 1 and 7) or (${t.zone} = 'trending' and ${t.position} between 1 and 14)`,
    ),
  ],
);

export const podcastEpisodes = pgTable('podcast_episodes', {
  id: uuid().primaryKey().defaultRandom(),
  show: text().notNull(),
  title: text().notNull(),
  url: text().notNull(),
  durationSec: integer(),
  episodeNumber: integer(),
  imageMediaId: uuid().references(() => mediaAssets.id),
  publishedAt: tstz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
export const comments = pgTable(
  'comments',
  {
    id: uuid().primaryKey().defaultRandom(),
    articleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    readerId: uuid()
      .notNull()
      .references(() => readers.id, { onDelete: 'cascade' }),
    /** One level of replies */
    parentId: uuid().references((): AnyPgColumn => comments.id, { onDelete: 'cascade' }),
    /** In a thread, the comment this one answers ("@name"); its author is notified. */
    replyToId: uuid().references((): AnyPgColumn => comments.id, { onDelete: 'set null' }),
    /** Plain text only; rendered escaped. */
    body: text().notNull(),
    status: commentStatus().notNull().default('visible'),
    reportCount: integer().notNull().default(0),
    /** Readers' likes (kept in step with comment_likes). */
    likeCount: integer().notNull().default(0),
    /** "בחירת העורכים": shown first, with a badge. */
    pickedAt: tstz(),
    pickedBy: uuid().references(() => users.id),
    moderatedBy: uuid().references(() => users.id),
    moderatedAt: tstz(),
    moderationNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_article_idx').on(t.articleId, t.status, t.createdAt.desc()),
    index('comments_reader_idx').on(t.readerId, t.createdAt.desc()),
    index('comments_queue_idx').on(t.status, t.reportCount, t.createdAt.desc()),
  ],
);

export const commentReports = pgTable(
  'comment_reports',
  {
    commentId: uuid()
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    readerId: uuid()
      .notNull()
      .references(() => readers.id, { onDelete: 'cascade' }),
    reason: reportReason().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.readerId] })],
);

/** A reader's like of a comment (one each; never their own). */
export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid()
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    readerId: uuid()
      .notNull()
      .references(() => readers.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.readerId] })],
);

/**
 * What a reader is told about: a reply to their comment, a like, the editors' pick. Shown on the
 * site and in the app at once (and as a push to the app); mailed together, at most once an hour.
 */
export const readerNotifications = pgTable(
  'reader_notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    readerId: uuid()
      .notNull()
      .references(() => readers.id, { onDelete: 'cascade' }),
    /** reply | like | pick */
    kind: text().notNull(),
    commentId: uuid()
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    /** Who replied or liked (null for the editors' pick, or once they deleted their account). */
    actorReaderId: uuid().references(() => readers.id, { onDelete: 'set null' }),
    articleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    readAt: tstz(),
    emailedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index('reader_notifications_reader_idx').on(t.readerId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Legal: consents and content-removal requests
// ---------------------------------------------------------------------------
/**
 * Every acceptance of the terms, kept as evidence: a signed-in reader, a newsletter
 * subscriber, or an anonymous visitor (consent banner / app welcome screen, keyed by a
 * random id from the browser or device). Deleting a reader deletes their rows.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid().primaryKey().defaultRandom(),
    subject: consentSubject().notNull(),
    readerId: uuid().references(() => readers.id, { onDelete: 'cascade' }),
    subscriberId: uuid().references(() => newsletterSubscribers.id, { onDelete: 'cascade' }),
    visitorId: uuid(),
    termsVersion: text().notNull(),
    /** Third-party advertising cookies (visitors only; null = not asked). */
    ads: boolean(),
    channel: consentChannel().notNull(),
    ipHash: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('consents_reader_idx').on(t.readerId, t.createdAt.desc()),
    index('consents_visitor_idx').on(t.visitorId, t.createdAt.desc()),
    check(
      'consents_one_subject',
      sql`(${t.subject} = 'reader' and ${t.readerId} is not null)
       or (${t.subject} = 'subscriber' and ${t.subscriberId} is not null)
       or (${t.subject} = 'visitor' and ${t.visitorId} is not null)`,
    ),
  ],
);

/** "Notice and takedown": a request from anyone to remove a comment or other content, with the decision. */
export const takedownRequests = pgTable(
  'takedown_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: takedownKind().notNull(),
    status: takedownStatus().notNull().default('new'),
    url: text().notNull(),
    commentId: uuid().references(() => comments.id, { onDelete: 'set null' }),
    name: text().notNull(),
    email: text().notNull(),
    details: text().notNull(),
    ipHash: text(),
    decisionNote: text(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: tstz(),
    /** Answer-by time shown in the CMS (TAKEDOWN_RESPONSE_HOURS after it arrived). */
    dueAt: tstz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('takedown_requests_queue_idx').on(t.status, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Social distribution
// ---------------------------------------------------------------------------
/** One account per network (enforced in services/social-accounts.ts); deleting one removes its posts. */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    platform: socialPlatform().notNull(),
    displayName: text().notNull(),
    externalId: text().notNull(),
    /** Key in the secrets manager; tokens never live in this database. */
    secretRef: text().notNull(),
    tokenExpiresAt: tstz(),
    /** Facebook, Instagram, X: the article link goes in the first comment. */
    linkInFirstComment: boolean().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('social_accounts_platform_external').on(t.platform, t.externalId)],
);

/** One package per article: 2-sentence caption + a social image distinct from the article image. */
export const socialPackages = pgTable('social_packages', {
  draftId: uuid()
    .primaryKey()
    .references(() => articleDrafts.id, { onDelete: 'cascade' }),
  headline: text().notNull().default(''),
  caption: text().notNull().default(''),
  aiBaselineCaption: text(),
  imageMediaId: uuid().references(() => mediaAssets.id),
  /** The article text was reopened after this package was made. */
  isStale: boolean().notNull().default(false),
  approvedAt: tstz(),
  approvedBy: uuid().references(() => users.id),
  version: integer().notNull().default(1),
  updatedAt: updatedAt(),
});

export const socialPosts = pgTable(
  'social_posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    draftId: uuid()
      .notNull()
      .references(() => socialPackages.draftId, { onDelete: 'cascade' }),
    /** Deleting an account removes its posts here too: nothing is sent to it, and it is no longer offered. */
    socialAccountId: uuid()
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    articleId: bigint({ mode: 'number' }).references(() => articles.id),
    format: socialFormat().notNull().default('feed'),
    enabled: boolean().notNull().default(true),
    captionOverride: text(),
    payload: jsonb(),
    status: socialPostStatus().notNull().default('draft'),
    externalPostId: text(),
    externalCommentId: text(),
    attempts: smallint().notNull().default(0),
    lastError: text(),
    postedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('social_posts_unique').on(t.draftId, t.socialAccountId, t.format),
    index('social_posts_status_idx').on(t.status),
  ],
);

/**
 * The social page: a branded post + story for an article that is already on the
 * site. Text by the AI, edited by the newsroom; the designs are rendered by the server.
 */
export const articleShares = pgTable('article_shares', {
  articleId: bigint({ mode: 'number' })
    .primaryKey()
    .references(() => articles.id, { onDelete: 'cascade' }),
  /** Design frame: headline | breaking | quote | explainer */
  template: text().notNull().default('headline'),
  /** Label above the headline on the image (the section, "מבזק", "מדריך"…) */
  kicker: text().notNull().default(''),
  headline: text().notNull().default(''),
  /** The opening sentence: on the image under the headline, and the first line of the post. */
  hook: text().notNull().default(''),
  caption: text().notNull().default(''),
  hashtags: text().array().notNull().default(sql`'{}'::text[]`),
  /** Background photo; null = the article's main image. */
  imageMediaId: uuid().references(() => mediaAssets.id, { onDelete: 'set null' }),
  /** Rendered designs: { feed, story, reel (mp4), reelPoster } -> storage key */
  rendered: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** What the editor wants for this article: feed | story | reel. Only these are rendered. */
  formats: text().array().notNull().default(sql`'{feed,story}'::text[]`),
  /** The reel's own picture: a new Gemini image in the spirit of the article's, never the same one. */
  reelImageMediaId: uuid().references(() => mediaAssets.id, { onDelete: 'set null' }),
  /** { model, durationSeconds, resolution, motion, instruction } for the video model */
  reelSettings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  /** Unused since 2026-10-13: Instagram's API can't attach a track from its music library (kept, migrations only add). */
  reelAudio: jsonb().$type<{ id: string; title: string; artist: string | null } | null>(),
  /** The reel's steps, each approved by the editor: { stage, imagePrompt, videoPrompt (Hebrew), approvedAt }; null = not started. */
  reelPlan: jsonb().$type<ReelPlan | null>(),
  /** The AI's first version, kept to compare with what the editors published. */
  aiBaseline: jsonb(),
  version: integer().notNull().default(1),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const articleSharePosts = pgTable(
  'article_share_posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    articleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => articleShares.articleId, { onDelete: 'cascade' }),
    /** As in social_posts: a deleted account takes its posts with it. */
    socialAccountId: uuid()
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    format: socialFormat().notNull(),
    status: socialPostStatus().notNull().default('queued'),
    externalPostId: text(),
    externalCommentId: text(),
    attempts: smallint().notNull().default(0),
    lastError: text(),
    postedAt: tstz(),
    requestedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique('article_share_posts_unique').on(t.articleId, t.socialAccountId, t.format), index('article_share_posts_status_idx').on(t.status)],
);

/**
 * The distribution plan of an article before it is published: the social editor's choices
 * (frame, post, story, a reel idea) and texts, changed by the newsroom in the report.
 * Publishing the article copies it to article_shares and sends it out.
 */
export const socialPlans = pgTable(
  'social_plans',
  {
    draftId: uuid()
      .primaryKey()
      .references(() => articleDrafts.id, { onDelete: 'cascade' }),
    /** false = the article doesn't go out to the networks automatically. */
    enabled: boolean().notNull().default(true),
    /** Design frame: headline | breaking | quote | explainer */
    template: text().notNull().default('headline'),
    kicker: text().notNull().default(''),
    headline: text().notNull().default(''),
    hook: text().notNull().default(''),
    caption: text().notNull().default(''),
    hashtags: text().array().notNull().default(sql`'{}'::text[]`),
    /** What goes out: feed | story | reel. "reel" is set only by a person (it costs a video). */
    formats: text().array().notNull().default(sql`'{feed,story}'::text[]`),
    /** The AI's reel suggestion; the idea and length may be the editor's. */
    reel: jsonb().$type<ReelIdea | null>(),
    /** The AI's reasons for the report, in Hebrew. */
    reasons: jsonb().$type<{ template: string; formats: string }>().notNull().default({ template: '', formats: '' }),
    /** The AI's latest choices, to learn from what the editors changed. */
    aiChoice: jsonb().$type<{ template: string; formats: string[]; reel: boolean } | null>(),
    /** agent | editor: once a person changes the frame, the formats or the reel, a new AI text keeps them. */
    choicesBy: text().notNull().default('agent'),
    /** Background photo; null = the article's main image. */
    imageMediaId: uuid().references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** Preview designs { feed, story, photo } -> storage keys (photo: the media id they were drawn on). */
    rendered: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** The article text was reopened after the plan was written. */
    isStale: boolean().notNull().default(false),
    /** Why the AI couldn't write the plan, in Hebrew. */
    lastError: text(),
    /** Set when the article is published and the plan moves to article_shares. */
    articleId: bigint({ mode: 'number' }).references(() => articles.id, { onDelete: 'set null' }),
    appliedAt: tstz(),
    version: integer().notNull().default(1),
    updatedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('social_plans_article_idx').on(t.articleId)],
);

// ---------------------------------------------------------------------------
// Learning loop
// ---------------------------------------------------------------------------
export const styleFeedback = pgTable(
  'style_feedback',
  {
    id: uuid().primaryKey().defaultRandom(),
    draftId: uuid()
      .notNull()
      .unique()
      .references(() => articleDrafts.id),
    articleId: bigint({ mode: 'number' }).references(() => articles.id),
    categoryId: smallint().references(() => categories.id),
    editorId: uuid().references(() => users.id),
    aiText: text().notNull(),
    finalText: text().notNull(),
    unifiedDiff: text().notNull(),
    /** 0 = published as the AI wrote it, 1 = fully rewritten */
    editRatio: real().notNull(),
    aiModel: text().notNull(),
    promptVersion: integer(),
    status: feedbackStatus().notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    index('style_feedback_category_idx').on(t.categoryId, t.createdAt.desc()),
    check('edit_ratio_range', sql`${t.editRatio} between 0 and 1`),
  ],
);

export const styleProfiles = pgTable('style_profiles', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  rules: text().notNull(),
  exampleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  feedbackCount: integer().notNull(),
  isActive: boolean().notNull().default(false),
  aiJobId: uuid().references(() => aiJobs.id),
  approvedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

/**
 * One learning pass per publish batch: every article of the batch (source, AI
 * draft, final text, images) in a single AI call that updates the house style.
 */
export const learningReports = pgTable(
  'learning_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    publishJobId: uuid()
      .unique()
      .references((): AnyPgColumn => publishJobs.id, { onDelete: 'set null' }),
    articleCount: integer().notNull(),
    /** succeeded | skipped | failed */
    status: text().notNull(),
    /** What was learned, in Hebrew, for the newsroom. */
    summary: text().notNull().default(''),
    /** The style profile this pass produced (null if nothing changed). */
    profileId: integer().references(() => styleProfiles.id),
    aiJobId: uuid().references(() => aiJobs.id),
    inputTokens: integer(),
    createdAt: createdAt(),
  },
  (t) => [index('learning_reports_created_idx').on(t.createdAt.desc())],
);

/** What the editors did with the visual agent's suggestions: an article's images, or a reel. */
export const visualFeedback = pgTable(
  'visual_feedback',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** One case per subject: "image:<draft id>" or "reel:<article id>:<approved at>". */
    subjectKey: text().notNull().unique(),
    /** article_image | reel */
    kind: text().notNull(),
    draftId: uuid().references(() => articleDrafts.id, { onDelete: 'set null' }),
    articleId: bigint({ mode: 'number' }).references(() => articles.id, { onDelete: 'set null' }),
    detail: jsonb().$type<VisualFeedbackDetail>().notNull(),
    /** The image the editor chose (or the reel picture they approved), for the agent to look at. */
    chosenMediaId: uuid().references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** Options the editor saw and passed over (a few). */
    rejectedMediaIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    status: feedbackStatus().notNull().default('pending'),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('visual_feedback_status_idx').on(t.status, t.createdAt.desc())],
);

/** The visual agent's learned rules, versioned like the house style (one active). */
export const visualProfiles = pgTable('visual_profiles', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  rules: text().notNull(),
  /** What this learning pass learned, in Hebrew, for the newsroom (null for an editor's own edit). */
  summary: text(),
  feedbackCount: integer().notNull().default(0),
  isActive: boolean().notNull().default(false),
  aiJobId: uuid().references(() => aiJobs.id),
  approvedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// The newsroom agent (chat in the CMS, and the Claude app through MCP)
// ---------------------------------------------------------------------------
export const agentConversations = pgTable(
  'agent_conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull().default(''),
    /** The model family running it (claude; gemini later). */
    engine: text().notNull().default('claude'),
    /** idle | working | awaiting_approval | failed */
    status: text().notNull().default('idle'),
    /** The Messages API history as sent and received (append-only, so cached and thinking blocks stay valid). */
    history: jsonb().$type<unknown[]>().notNull().default([]),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('agent_conversations_user_idx').on(t.userId, t.updatedAt.desc())],
);

/** What the chat shows: messages, actions (with their approval state) and notices. */
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid()
      .notNull()
      .references(() => agentConversations.id, { onDelete: 'cascade' }),
    /** user | assistant | action | notice */
    kind: text().notNull(),
    text: text().notNull().default(''),
    /** action: { toolUseId, tool, input, write, status, result } */
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index('agent_messages_conversation_idx').on(t.conversationId, t.id)],
);

/** Personal access tokens for the Claude app (MCP). Only a hash is stored. */
export const staffApiTokens = pgTable('staff_api_tokens', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  tokenHash: text().notNull().unique(),
  lastUsedAt: tstz(),
  revokedAt: tstz(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
/** One "publish" click: a whole magazine, or one single saved article. Site first, then social. */
export const publishJobs = pgTable(
  'publish_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    magazineId: uuid().references(() => magazines.id),
    draftId: uuid().references(() => articleDrafts.id),
    idempotencyKey: text().notNull().unique(),
    status: jobStatus().notNull().default('queued'),
    /** "<draftId>:site" / "<draftId>:<platform>" -> "ok" | "failed: ..." | "skipped" */
    steps: jsonb().$type<Record<string, string>>().notNull().default({}),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    startedAt: tstz(),
    finishedAt: tstz(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [check('publish_jobs_one_target', sql`(${t.magazineId} is null) <> (${t.draftId} is null)`)],
);

/**
 * Background work queue (AI calls, discovery runs, publishing). Workers claim
 * rows with FOR UPDATE SKIP LOCKED, so any number of worker processes can share it.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus().notNull().default('queued'),
    /** The draft a job works on, so the editor can show that the AI is busy with it. */
    draftId: uuid().references(() => articleDrafts.id, { onDelete: 'cascade' }),
    runAt: tstz().notNull().defaultNow(),
    attempts: smallint().notNull().default(0),
    maxAttempts: smallint().notNull().default(3),
    lockedAt: tstz(),
    lockedBy: text(),
    result: jsonb(),
    lastError: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    finishedAt: tstz(),
  },
  (t) => [index('jobs_queue_idx').on(t.status, t.runAt), index('jobs_draft_idx').on(t.draftId, t.createdAt.desc())],
);

export const devices = pgTable('devices', {
  id: uuid().primaryKey().defaultRandom(),
  platform: devicePlatform().notNull(),
  pushToken: text().notNull().unique(),
  /** The reader signed in on this device (their replies and likes reach it). */
  readerId: uuid().references(() => readers.id, { onDelete: 'set null' }),
  topics: text().array().notNull().default(sql`'{breaking}'::text[]`),
  appVersion: text(),
  locale: text().notNull().default('he'),
  createdAt: createdAt(),
  lastSeenAt: tstz().notNull().defaultNow(),
});

export const pushNotifications = pgTable('push_notifications', {
  id: uuid().primaryKey().defaultRandom(),
  articleId: bigint({ mode: 'number' }).references(() => articles.id),
  title: text().notNull(),
  body: text().notNull(),
  topic: text().notNull().default('breaking'),
  deepLink: text().notNull(),
  provider: text().notNull().default('expo'),
  providerMessageId: text(),
  status: jobStatus().notNull().default('queued'),
  sentBy: uuid().references(() => users.id),
  sentAt: tstz(),
  createdAt: createdAt(),
});

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  confirmTokenHash: text().unique(),
  confirmedAt: tstz(),
  unsubscribedAt: tstz(),
  /** "העיתון שלי": topics, time and frequency (null: every topic, 07:00, daily). */
  digest: jsonb().$type<DigestPrefs>(),
  lastDigestAt: tstz(),
  createdAt: createdAt(),
});

/** Non-secret settings the newsroom manages in the CMS (site links, contact details, info pages). */
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => users.id),
  updatedAt: updatedAt(),
});

/**
 * API keys and tokens entered in the CMS. Encrypted with AES-256-GCM under
 * SECRETS_KEY (never stored in the database); only the last characters are kept in clear as a hint.
 */
export const secrets = pgTable('secrets', {
  key: text().primaryKey(),
  ciphertext: text().notNull(),
  hint: text().notNull(),
  updatedBy: uuid().references(() => users.id),
  updatedAt: updatedAt(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid().references(() => users.id),
    /** Kept when the reader deletes their account; only the link to them goes. */
    actorReaderId: uuid().references(() => readers.id, { onDelete: 'set null' }),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: text().notNull(),
    details: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId, t.createdAt.desc())],
);
