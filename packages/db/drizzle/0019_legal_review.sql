ALTER TYPE "public"."ai_job_type" ADD VALUE 'legal_review';--> statement-breakpoint
CREATE TABLE "draft_reviews" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'checking' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"checked_at" timestamp with time zone,
	"waived_by" uuid,
	"waived_at" timestamp with time zone,
	"waive_reason" text,
	"notified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;