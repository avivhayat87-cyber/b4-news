ALTER TABLE "login_codes" ADD COLUMN "link_token_hash" text;--> statement-breakpoint
ALTER TABLE "login_codes" ADD COLUMN "terms_accepted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "login_codes" ADD COLUMN "return_to" text;--> statement-breakpoint
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_linkTokenHash_unique" UNIQUE("link_token_hash");