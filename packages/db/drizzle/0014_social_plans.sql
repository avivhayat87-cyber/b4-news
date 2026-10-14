CREATE TABLE "social_plans" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"template" text DEFAULT 'headline' NOT NULL,
	"kicker" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"formats" text[] DEFAULT '{feed,story}'::text[] NOT NULL,
	"reel" jsonb,
	"reasons" jsonb DEFAULT '{"template":"","formats":""}'::jsonb NOT NULL,
	"ai_choice" jsonb,
	"choices_by" text DEFAULT 'agent' NOT NULL,
	"image_media_id" uuid,
	"rendered" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"article_id" bigint,
	"applied_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_plans" ADD CONSTRAINT "social_plans_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_plans" ADD CONSTRAINT "social_plans_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_plans" ADD CONSTRAINT "social_plans_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_plans" ADD CONSTRAINT "social_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_plans_article_idx" ON "social_plans" USING btree ("article_id");