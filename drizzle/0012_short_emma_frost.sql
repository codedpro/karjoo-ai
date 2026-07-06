DROP INDEX "candidate_profiles_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profiles_user_uq" ON "candidate_profiles" USING btree ("user_id");