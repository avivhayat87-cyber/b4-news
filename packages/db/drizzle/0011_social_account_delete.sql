ALTER TABLE "article_share_posts" DROP CONSTRAINT "article_share_posts_social_account_id_social_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "social_posts" DROP CONSTRAINT "social_posts_social_account_id_social_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "article_share_posts" ADD CONSTRAINT "article_share_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;