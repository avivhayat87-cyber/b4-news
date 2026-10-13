CREATE TYPE "public"."source_region" AS ENUM('local', 'international');--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "region" "source_region" DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD COLUMN "title_he" text;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD COLUMN "intro_he" text;--> statement-breakpoint
ALTER TABLE "scraped_items" ADD COLUMN "body_he" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "region" "source_region" DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "language" text;