ALTER TABLE "newsletter_subscribers" ADD COLUMN "digest" jsonb;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN "last_digest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "readers" ADD COLUMN "digest" jsonb;--> statement-breakpoint
ALTER TABLE "readers" ADD COLUMN "last_digest_at" timestamp with time zone;