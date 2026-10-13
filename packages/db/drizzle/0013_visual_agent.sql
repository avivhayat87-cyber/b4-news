ALTER TYPE "public"."ai_job_type" ADD VALUE 'visual_prompt';--> statement-breakpoint
ALTER TYPE "public"."ai_job_type" ADD VALUE 'visual_learning';--> statement-breakpoint
CREATE TABLE "visual_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_key" text NOT NULL,
	"kind" text NOT NULL,
	"draft_id" uuid,
	"article_id" bigint,
	"detail" jsonb NOT NULL,
	"chosen_media_id" uuid,
	"rejected_media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "feedback_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visual_feedback_subjectKey_unique" UNIQUE("subject_key")
);
--> statement-breakpoint
CREATE TABLE "visual_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "visual_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rules" text NOT NULL,
	"summary" text,
	"feedback_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"ai_job_id" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_batches" ADD COLUMN "prompt_by" text;--> statement-breakpoint
ALTER TABLE "visual_feedback" ADD CONSTRAINT "visual_feedback_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_feedback" ADD CONSTRAINT "visual_feedback_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_feedback" ADD CONSTRAINT "visual_feedback_chosen_media_id_media_assets_id_fk" FOREIGN KEY ("chosen_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_feedback" ADD CONSTRAINT "visual_feedback_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_profiles" ADD CONSTRAINT "visual_profiles_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_profiles" ADD CONSTRAINT "visual_profiles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visual_feedback_status_idx" ON "visual_feedback" USING btree ("status","created_at" DESC NULLS LAST);