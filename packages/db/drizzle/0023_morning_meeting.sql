-- data-safe: loosens the column (the morning meeting has no person who called it); every existing row keeps its value
ALTER TABLE "editorial_meetings" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "editorial_meetings" ADD COLUMN "notified_at" timestamp with time zone;