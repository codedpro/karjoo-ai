ALTER TABLE "job_listings" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "job_listings_board_posted_idx" ON "job_listings" USING btree ("board","posted_at");--> statement-breakpoint
CREATE INDEX "job_listings_last_seen_idx" ON "job_listings" USING btree ("last_seen_at");