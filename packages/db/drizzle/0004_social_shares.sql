CREATE TABLE "article_share_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" bigint NOT NULL,
	"social_account_id" uuid NOT NULL,
	"format" "social_format" NOT NULL,
	"status" "social_post_status" DEFAULT 'queued' NOT NULL,
	"external_post_id" text,
	"external_comment_id" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"posted_at" timestamp with time zone,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_share_posts_unique" UNIQUE("article_id","social_account_id","format")
);
--> statement-breakpoint
CREATE TABLE "article_shares" (
	"article_id" bigint PRIMARY KEY NOT NULL,
	"template" text DEFAULT 'headline' NOT NULL,
	"kicker" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_media_id" uuid,
	"rendered" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_baseline" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_share_posts" ADD CONSTRAINT "article_share_posts_article_id_article_shares_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article_shares"("article_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_share_posts" ADD CONSTRAINT "article_share_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_share_posts" ADD CONSTRAINT "article_share_posts_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_share_posts_status_idx" ON "article_share_posts" USING btree ("status");