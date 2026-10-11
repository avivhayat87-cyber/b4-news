CREATE TYPE "public"."ai_job_type" AS ENUM('rewrite', 'refine', 'article_images', 'social_caption', 'social_image', 'style_distill', 'classify');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('published', 'scheduled', 'unpublished');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('topic', 'column');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."comment_status" AS ENUM('visible', 'hidden', 'removed');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."draft_color" AS ENUM('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray');--> statement-breakpoint
CREATE TYPE "public"."draft_origin" AS ENUM('scraped', 'manual_url', 'manual_write');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('queued_ai', 'ai_processing', 'ai_failed', 'editing', 'text_final', 'ready', 'skipped', 'published');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('pending', 'distilled', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."homepage_placement" AS ENUM('main', 'trending', 'none');--> statement-breakpoint
CREATE TYPE "public"."homepage_zone" AS ENUM('main', 'trending');--> statement-breakpoint
CREATE TYPE "public"."image_purpose" AS ENUM('article', 'social');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."magazine_status" AS ENUM('draft', 'editing', 'ready', 'publishing', 'published', 'partially_failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('upload', 'scraped_original', 'ai_article', 'ai_social');--> statement-breakpoint
CREATE TYPE "public"."reader_status" AS ENUM('active', 'banned');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'abuse', 'misinformation', 'other');--> statement-breakpoint
CREATE TYPE "public"."revision_source" AS ENUM('ai_initial', 'ai_refine', 'human_autosave', 'human_checkpoint', 'restore');--> statement-breakpoint
CREATE TYPE "public"."run_item_origin" AS ENUM('found', 'pulled');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('manual', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."scrape_method" AS ENUM('rss', 'sitemap', 'html', 'html_js');--> statement-breakpoint
CREATE TYPE "public"."scraped_item_status" AS ENUM('new', 'in_draft', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('staff', 'reader');--> statement-breakpoint
CREATE TYPE "public"."social_format" AS ENUM('feed', 'story', 'message');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('facebook', 'instagram', 'telegram', 'whatsapp', 'x', 'tiktok');--> statement-breakpoint
CREATE TYPE "public"."social_post_status" AS ENUM('draft', 'queued', 'posting', 'posted', 'comment_failed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending_dev', 'in_development', 'active', 'paused', 'broken', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor', 'developer', 'viewer');--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"draft_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"selection" jsonb,
	"revision_id" bigint,
	"ai_job_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "ai_job_type" NOT NULL,
	"draft_id" uuid,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_key" text,
	"prompt_version" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"image_count" integer,
	"cost_usd" numeric(10, 4),
	"latency_ms" integer,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "article_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"magazine_id" uuid,
	"position" smallint DEFAULT 0 NOT NULL,
	"origin" "draft_origin" NOT NULL,
	"scraped_item_id" uuid,
	"status" "draft_status" DEFAULT 'queued_ai' NOT NULL,
	"color_label" "draft_color",
	"title" text DEFAULT '' NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"body_doc" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"ai_baseline_title" text,
	"ai_baseline_text" text,
	"ai_baseline_job_id" uuid,
	"category_id" smallint,
	"placement" "homepage_placement" DEFAULT 'none' NOT NULL,
	"author_id" uuid,
	"hero_media_id" uuid,
	"tag_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"send_push" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"locked_by" uuid,
	"lock_expires_at" timestamp with time zone,
	"text_finalized_at" timestamp with time zone,
	"skip_reason" text,
	"published_article_id" bigint,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "original_required" CHECK ("article_drafts"."origin" = 'manual_write' or "article_drafts"."scraped_item_id" is not null),
	CONSTRAINT "ready_means_complete" CHECK ("article_drafts"."status" not in ('ready', 'published') or ("article_drafts"."category_id" is not null and "article_drafts"."hero_media_id" is not null and "article_drafts"."text_finalized_at" is not null and "article_drafts"."title" <> ''))
);
--> statement-breakpoint
CREATE TABLE "article_tags" (
	"article_id" bigint NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "article_tags_article_id_tag_id_pk" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"status" "article_status" DEFAULT 'published' NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"body_doc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_html" text NOT NULL,
	"excerpt" text NOT NULL,
	"category_id" smallint NOT NULL,
	"author_id" uuid,
	"editor_id" uuid,
	"hero_media_id" uuid,
	"source_id" uuid,
	"source_url" text,
	"seo_title" text,
	"seo_description" text,
	"reading_minutes" smallint DEFAULT 3 NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"draft_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || subtitle || ' ' || excerpt)) STORED,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "articles_draftId_unique" UNIQUE("draft_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"actor_reader_id" uuid,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"bio" text,
	"avatar_media_id" uuid,
	"is_columnist" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authors_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"parent_id" smallint,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" DEFAULT 'topic' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "comment_reports" (
	"comment_id" uuid NOT NULL,
	"reader_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reports_comment_id_reader_id_pk" PRIMARY KEY("comment_id","reader_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" bigint NOT NULL,
	"reader_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"status" "comment_status" DEFAULT 'visible' NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "device_platform" NOT NULL,
	"push_token" text NOT NULL,
	"topics" text[] DEFAULT '{breaking}'::text[] NOT NULL,
	"app_version" text,
	"locale" text DEFAULT 'he' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_pushToken_unique" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE "draft_revisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "draft_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source" "revision_source" NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"body_doc" jsonb NOT NULL,
	"body_text" text NOT NULL,
	"ai_job_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_slots" (
	"zone" "homepage_zone" NOT NULL,
	"position" smallint NOT NULL,
	"article_id" bigint NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homepage_slots_zone_article_id_pk" PRIMARY KEY("zone","article_id"),
	CONSTRAINT "homepage_slots_position_unique" UNIQUE("zone","position"),
	CONSTRAINT "homepage_slots_position_range" CHECK (("homepage_slots"."zone" = 'main' and "homepage_slots"."position" between 1 and 7) or ("homepage_slots"."zone" = 'trending' and "homepage_slots"."position" between 1 and 14))
);
--> statement-breakpoint
CREATE TABLE "image_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"purpose" "image_purpose" NOT NULL,
	"prompt" text NOT NULL,
	"ai_job_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magazines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "magazine_status" DEFAULT 'draft' NOT NULL,
	"from_run_id" uuid,
	"created_by" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"original_url" text,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"focal_x" real DEFAULT 0.5 NOT NULL,
	"focal_y" real DEFAULT 0.5 NOT NULL,
	"alt_text" text,
	"credit" text,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"ai_prompt" text,
	"generation_batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storageKey_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"confirm_token_hash" text,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email"),
	CONSTRAINT "newsletter_subscribers_confirmTokenHash_unique" UNIQUE("confirm_token_hash")
);
--> statement-breakpoint
CREATE TABLE "podcast_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"duration_sec" integer,
	"episode_number" integer,
	"image_media_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_templates_key_version_pk" PRIMARY KEY("key","version")
);
--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"magazine_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_jobs_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "push_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" bigint,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"topic" text DEFAULT 'breaking' NOT NULL,
	"deep_link" text NOT NULL,
	"provider" text DEFAULT 'expo' NOT NULL,
	"provider_message_id" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "reader_status" DEFAULT 'active' NOT NULL,
	"banned_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "readers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "scrape_run_items" (
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"origin" "run_item_origin" DEFAULT 'found' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scrape_run_items_run_id_item_id_pk" PRIMARY KEY("run_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "scrape_run_sources" (
	"run_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"since" timestamp with time zone,
	"new_watermark" timestamp with time zone,
	"items_found" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"error" text,
	"duration_ms" integer,
	CONSTRAINT "scrape_run_sources_run_id_source_id_pk" PRIMARY KEY("run_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"triggered_by" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"items_found" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraped_item_payloads" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"raw_html" text,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraped_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"first_run_id" uuid,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"content_hash" text,
	"title" text NOT NULL,
	"intro" text,
	"body_text" text,
	"image_url" text,
	"thumbnail_media_id" uuid,
	"published_at" timestamp with time zone,
	"category_id" smallint,
	"status" "scraped_item_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scraped_items_urlHash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "session_kind" NOT NULL,
	"user_id" uuid,
	"reader_id" uuid,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_one_subject" CHECK (("sessions"."kind" = 'staff' and "sessions"."user_id" is not null and "sessions"."reader_id" is null)
       or ("sessions"."kind" = 'reader' and "sessions"."reader_id" is not null and "sessions"."user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "social_platform" NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text NOT NULL,
	"secret_ref" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"link_in_first_comment" boolean NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_platform_external" UNIQUE("platform","external_id")
);
--> statement-breakpoint
CREATE TABLE "social_packages" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"ai_baseline_caption" text,
	"image_media_id" uuid,
	"is_stale" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"article_id" bigint,
	"format" "social_format" DEFAULT 'feed' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"caption_override" text,
	"payload" jsonb,
	"status" "social_post_status" DEFAULT 'draft' NOT NULL,
	"external_post_id" text,
	"external_comment_id" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_unique" UNIQUE("draft_id","social_account_id","format")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"list_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"method" "scrape_method",
	"selector_config" jsonb,
	"default_category_id" smallint,
	"status" "source_status" DEFAULT 'pending_dev' NOT NULL,
	"scrape_interval_min" integer DEFAULT 30 NOT NULL,
	"watermark_published_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_test_passed_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"dev_notes" text,
	"requested_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_baseUrl_unique" UNIQUE("base_url"),
	CONSTRAINT "active_source_is_configured" CHECK ("sources"."status" <> 'active' or ("sources"."method" is not null and "sources"."selector_config" is not null and "sources"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "style_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"article_id" bigint,
	"category_id" smallint,
	"editor_id" uuid,
	"ai_text" text NOT NULL,
	"final_text" text NOT NULL,
	"unified_diff" text NOT NULL,
	"edit_ratio" real NOT NULL,
	"ai_model" text NOT NULL,
	"prompt_version" integer,
	"status" "feedback_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_feedback_draftId_unique" UNIQUE("draft_id"),
	CONSTRAINT "edit_ratio_range" CHECK ("style_feedback"."edit_ratio" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "style_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rules" text NOT NULL,
	"example_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"feedback_count" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"ai_job_id" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'editor' NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_revision_id_draft_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."draft_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_magazine_id_magazines_id_fk" FOREIGN KEY ("magazine_id") REFERENCES "public"."magazines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_scraped_item_id_scraped_items_id_fk" FOREIGN KEY ("scraped_item_id") REFERENCES "public"."scraped_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_ai_baseline_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_baseline_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_hero_media_id_media_assets_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_published_article_id_articles_id_fk" FOREIGN KEY ("published_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_hero_media_id_media_assets_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_reader_id_readers_id_fk" FOREIGN KEY ("actor_reader_id") REFERENCES "public"."readers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_avatar_media_id_media_assets_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_slots" ADD CONSTRAINT "homepage_slots_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_batches" ADD CONSTRAINT "image_batches_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_batches" ADD CONSTRAINT "image_batches_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_batches" ADD CONSTRAINT "image_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazines" ADD CONSTRAINT "magazines_from_run_id_scrape_runs_id_fk" FOREIGN KEY ("from_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazines" ADD CONSTRAINT "magazines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_generation_batch_id_image_batches_id_fk" FOREIGN KEY ("generation_batch_id") REFERENCES "public"."image_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episodes" ADD CONSTRAINT "podcast_episodes_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_magazine_id_magazines_id_fk" FOREIGN KEY ("magazine_id") REFERENCES "public"."magazines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_run_items" ADD CONSTRAINT "scrape_run_items_run_id_scrape_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_run_items" ADD CONSTRAINT "scrape_run_items_item_id_scraped_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scraped_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_run_sources" ADD CONSTRAINT "scrape_run_sources_run_id_scrape_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_run_sources" ADD CONSTRAINT "scrape_run_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_item_payloads" ADD CONSTRAINT "scraped_item_payloads_item_id_scraped_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scraped_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD CONSTRAINT "scraped_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD CONSTRAINT "scraped_items_first_run_id_scrape_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD CONSTRAINT "scraped_items_thumbnail_media_id_media_assets_id_fk" FOREIGN KEY ("thumbnail_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD CONSTRAINT "scraped_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_draft_id_social_packages_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."social_packages"("draft_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_default_category_id_categories_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_feedback" ADD CONSTRAINT "style_feedback_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_feedback" ADD CONSTRAINT "style_feedback_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_feedback" ADD CONSTRAINT "style_feedback_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_feedback" ADD CONSTRAINT "style_feedback_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_messages_draft_idx" ON "ai_chat_messages" USING btree ("draft_id","id");--> statement-breakpoint
CREATE INDEX "ai_jobs_created_idx" ON "ai_jobs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_jobs_draft_idx" ON "ai_jobs" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "article_drafts_magazine_idx" ON "article_drafts" USING btree ("magazine_id","position");--> statement-breakpoint
CREATE INDEX "article_drafts_status_idx" ON "article_drafts" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "article_tags_tag_idx" ON "article_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "articles_category_idx" ON "articles" USING btree ("category_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "articles_search_idx" ON "articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_article_idx" ON "comments" USING btree ("article_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_reader_idx" ON "comments" USING btree ("reader_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_queue_idx" ON "comments" USING btree ("status","report_count","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "draft_revisions_draft_idx" ON "draft_revisions" USING btree ("draft_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "image_batches_draft_idx" ON "image_batches" USING btree ("draft_id","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "magazines_status_idx" ON "magazines" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scrape_run_items_item_idx" ON "scrape_run_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_created_idx" ON "scrape_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scraped_items_source_idx" ON "scraped_items" USING btree ("source_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scraped_items_category_idx" ON "scraped_items" USING btree ("category_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scraped_items_content_idx" ON "scraped_items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "social_posts_status_idx" ON "social_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "style_feedback_category_idx" ON "style_feedback" USING btree ("category_id","created_at" DESC NULLS LAST);