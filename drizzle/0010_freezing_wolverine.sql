ALTER TABLE "candidate_profiles" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "work_experience" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "education" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "expected_salary" text;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_files" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_files_primary_uq" ON "resume_files" USING btree ("user_id") WHERE is_primary = true;