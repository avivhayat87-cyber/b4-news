ALTER TYPE "public"."ai_job_type" ADD VALUE 'desk_plan';--> statement-breakpoint
ALTER TABLE "article_drafts" ADD COLUMN "ticker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD COLUMN "desk_plan" jsonb;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD COLUMN "stuck_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "ticker_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "image_batches" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "image_batches" ADD COLUMN "pick" jsonb;--> statement-breakpoint
CREATE INDEX "articles_ticker_idx" ON "articles" USING btree ("ticker_at" DESC NULLS LAST);