ALTER TABLE "research_tasks" ADD COLUMN "target_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD COLUMN "update" jsonb;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_target_draft_id_article_drafts_id_fk" FOREIGN KEY ("target_draft_id") REFERENCES "public"."article_drafts"("id") ON DELETE set null ON UPDATE no action;