CREATE TYPE "public"."consent_channel" AS ENUM('web', 'app');--> statement-breakpoint
CREATE TYPE "public"."consent_subject" AS ENUM('reader', 'subscriber', 'visitor');--> statement-breakpoint
CREATE TYPE "public"."takedown_kind" AS ENUM('defamation', 'privacy', 'copyright', 'hate', 'other');--> statement-breakpoint
CREATE TYPE "public"."takedown_status" AS ENUM('new', 'in_review', 'removed', 'rejected');--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" "consent_subject" NOT NULL,
	"reader_id" uuid,
	"subscriber_id" uuid,
	"visitor_id" uuid,
	"terms_version" text NOT NULL,
	"ads" boolean,
	"channel" "consent_channel" NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_one_subject" CHECK (("consents"."subject" = 'reader' and "consents"."reader_id" is not null)
       or ("consents"."subject" = 'subscriber' and "consents"."subscriber_id" is not null)
       or ("consents"."subject" = 'visitor' and "consents"."visitor_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "takedown_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "takedown_kind" NOT NULL,
	"status" "takedown_status" DEFAULT 'new' NOT NULL,
	"url" text NOT NULL,
	"comment_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"details" text NOT NULL,
	"ip_hash" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_reader_id_readers_id_fk";
--> statement-breakpoint
ALTER TABLE "article_drafts" ADD COLUMN "disclosure" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "disclosure" text;--> statement-breakpoint
ALTER TABLE "readers" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "readers" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_subscriber_id_newsletter_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_reader_idx" ON "consents" USING btree ("reader_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consents_visitor_idx" ON "consents" USING btree ("visitor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "takedown_requests_queue_idx" ON "takedown_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_reader_id_readers_id_fk" FOREIGN KEY ("actor_reader_id") REFERENCES "public"."readers"("id") ON DELETE set null ON UPDATE no action;