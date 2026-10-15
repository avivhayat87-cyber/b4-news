ALTER TYPE "public"."ai_job_type" ADD VALUE 'meeting';--> statement-breakpoint
CREATE TABLE "editorial_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"focus" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"items_read" integer DEFAULT 0 NOT NULL,
	"topics" integer DEFAULT 0 NOT NULL,
	"pitches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"last_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_meetings" ADD CONSTRAINT "editorial_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editorial_meetings_created_idx" ON "editorial_meetings" USING btree ("created_at" DESC NULLS LAST);