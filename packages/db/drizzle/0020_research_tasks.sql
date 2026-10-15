ALTER TYPE "public"."ai_job_type" ADD VALUE 'research';--> statement-breakpoint
ALTER TYPE "public"."draft_origin" ADD VALUE 'research';--> statement-breakpoint
CREATE TABLE "research_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"depth" text DEFAULT 'quick' NOT NULL,
	"url" text,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"magazine_id" uuid,
	"color_label" "draft_color",
	"status" text DEFAULT 'queued' NOT NULL,
	"dossier" jsonb,
	"similar" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_id" uuid,
	"searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"last_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_magazine_id_magazines_id_fk" FOREIGN KEY ("magazine_id") REFERENCES "public"."magazines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_draft_id_article_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_tasks_created_idx" ON "research_tasks" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_tasks_draft_idx" ON "research_tasks" USING btree ("draft_id");