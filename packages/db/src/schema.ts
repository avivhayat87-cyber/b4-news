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
import { COMMENT_STATUSES, REPORT_REASONS, STAFF_ROLES, type SelectorConfig } from '@b4/shared';

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
export const mediaKind = pgEnum('media_kind', ['upload', 'scraped_original', 'ai_article', 'ai_social']);
export const imagePurpose = pgEnum('image_purpose', ['article', 'social']);
export const aiJobType = pgEnum('ai_job_type', ['rewrite', 'refine', 'article_images', 'social_caption', 'social_image', 'style_distill', 'classify']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const chatRole = pgEnum('chat_role', ['user', 'assistant']);
export const articleStatus = pgEnum('article_status', ['published', 'scheduled', 'unpublished']);
export const commentStatus = pgEnum('comment_status', COMMENT_STATUSES);
export const reportReason = pgEnum('report_reason', REPORT_REASONS);
export const socialPlatform = pgEnum('social_platform', ['facebook', 'instagram', 'telegram', 'whatsapp', 'x', 'tiktok']);
export const socialFormat = pgEnum('social_format', ['feed', 'story', 'message']);
export const socialPostStatus = pgEnum('social_post_status', ['draft', 'queued', 'posting', 'posted', 'comment_failed', 'failed', 'skipped']);
export const feedbackStatus = pgEnum('feedback_status', ['pending', 'distilled', 'excluded']);
export const devicePlatform = pgEnum('device_platform', ['ios', 'android', 'web']);

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Registered readers (comments). Sign-in is by one-time email code; no passwords. */
export const readers = pgTable('readers', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  displayName: text().notNull(),
  status: readerStatus().notNull().default('active'),
  bannedReason: text(),
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
    /** Image prompt the AI wrote with the rewrite; the default for "4 images". */
    imagePrompt: text(),
    placement: homepagePlacement().notNull().default('none'),
    authorId: uuid().references(() => authors.id),
    heroMediaId: uuid().references(() => mediaAssets.id),
    tagNames: text().array().notNull().default(sql`'{}'::text[]`),
    sendPush: boolean().notNull().default(false),

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

/** Each "generate" click = one batch of 4 options. */
export const imageBatches = pgTable(
  'image_batches',
  {
    id: uuid().primaryKey().defaultRandom(),
    draftId: uuid()
      .notNull()
      .references(() => articleDrafts.id, { onDelete: 'cascade' }),
    purpose: imagePurpose().notNull(),
    prompt: text().notNull(),
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
    /** Plain text only; rendered escaped. */
    body: text().notNull(),
    status: commentStatus().notNull().default('visible'),
    reportCount: integer().notNull().default(0),
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

// ---------------------------------------------------------------------------
// Social distribution
// ---------------------------------------------------------------------------
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
    socialAccountId: uuid()
      .notNull()
      .references(() => socialAccounts.id),
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
    actorReaderId: uuid().references(() => readers.id),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: text().notNull(),
    details: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId, t.createdAt.desc())],
);
