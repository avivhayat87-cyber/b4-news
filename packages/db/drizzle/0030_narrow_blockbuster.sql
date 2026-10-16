CREATE TYPE "public"."read_source" AS ENUM('direct', 'search', 'social', 'internal', 'other', 'app');--> statement-breakpoint
CREATE TABLE "article_reads" (
	"day" text NOT NULL,
	"article_id" bigint NOT NULL,
	"source" "read_source" NOT NULL,
	"reads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "article_reads_day_article_id_source_pk" PRIMARY KEY("day","article_id","source")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "byline_name" text;--> statement-breakpoint
ALTER TABLE "article_reads" ADD CONSTRAINT "article_reads_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_reads_article_idx" ON "article_reads" USING btree ("article_id");