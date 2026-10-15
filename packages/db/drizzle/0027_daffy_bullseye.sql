ALTER TYPE "public"."ai_job_type" ADD VALUE 'discovery_pick';--> statement-breakpoint
ALTER TABLE "article_drafts" ADD COLUMN "extra_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_run_items" ADD COLUMN "separated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "picks" jsonb;