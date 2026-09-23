ALTER TABLE "job_listings" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "job_listings" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "job_listings" ADD COLUMN "is_remote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_listings" ADD COLUMN "city_norm" text;--> statement-breakpoint
CREATE INDEX "job_listings_category_idx" ON "job_listings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "job_listings_city_norm_idx" ON "job_listings" USING btree ("city_norm");--> statement-breakpoint
CREATE INDEX "job_listings_posted_idx" ON "job_listings" USING btree ("posted_at");