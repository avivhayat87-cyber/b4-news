ALTER TYPE "public"."ai_job_type" ADD VALUE 'social_video';--> statement-breakpoint
ALTER TYPE "public"."social_format" ADD VALUE 'reel';--> statement-breakpoint
ALTER TABLE "article_shares" ADD COLUMN "formats" text[] DEFAULT '{feed,story}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "article_shares" ADD COLUMN "reel_image_media_id" uuid;--> statement-breakpoint
ALTER TABLE "article_shares" ADD COLUMN "reel_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "article_shares" ADD COLUMN "reel_audio" jsonb;--> statement-breakpoint
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_reel_image_media_id_media_assets_id_fk" FOREIGN KEY ("reel_image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;