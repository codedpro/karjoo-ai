CREATE TYPE "public"."application_status" AS ENUM('draft', 'submitted', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."apply_channel" AS ENUM('extension', 'worker');--> statement-breakpoint
CREATE TYPE "public"."apply_type" AS ENUM('structured', 'contact');--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('session_captured', 'session_refreshed', 'session_used', 'session_expired', 'apply_queued', 'apply_submitted', 'apply_failed');--> statement-breakpoint
CREATE TYPE "public"."board_account_status" AS ENUM('connected', 'expired', 'needs_reauth');--> statement-breakpoint
CREATE TYPE "public"."job_board" AS ENUM('jobvision', 'jobinja', 'e-estekhdam', 'karboom', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('pending', 'scored', 'drafted', 'queued', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."session_shape" AS ENUM('cookie', 'token');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'leased', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."worker_health" AS ENUM('online', 'degraded', 'offline');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"resume_id" uuid,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"channel" "apply_channel",
	"match_score" double precision,
	"cover_letter" text,
	"reason" text,
	"external_ref" text,
	"proof" jsonb,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"board_account_id" uuid,
	"application_id" uuid,
	"event_type" "audit_event_type" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"board" "job_board" NOT NULL,
	"status" "board_account_status" DEFAULT 'needs_reauth' NOT NULL,
	"account_label" text,
	"session_shape" "session_shape" NOT NULL,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"headline" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"years_experience" integer,
	"city" text,
	"resume_text" text,
	"preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board" "job_board" NOT NULL,
	"external_id" text NOT NULL,
	"canonical_id" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"city" text,
	"url" text NOT NULL,
	"description" text,
	"salary" text,
	"apply_type" "apply_type" DEFAULT 'structured' NOT NULL,
	"posted_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"score" double precision,
	"status" "match_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"cover_letter" text,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board" "job_board" NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"listing_id" uuid,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"base_resume_id" uuid,
	"listing_id" uuid,
	"is_base" boolean DEFAULT true NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_account_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"session_shape" "session_shape" NOT NULL,
	"last_refreshed" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"match_id" uuid NOT NULL,
	"session_ref" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_by" uuid,
	"leased_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"full_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_key" text NOT NULL,
	"region" text,
	"health" "worker_health" DEFAULT 'offline' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_listing_id_job_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."job_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_board_account_id_board_accounts_id_fk" FOREIGN KEY ("board_account_id") REFERENCES "public"."board_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_accounts" ADD CONSTRAINT "board_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_listing_id_job_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."job_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_listings" ADD CONSTRAINT "raw_listings_listing_id_job_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."job_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_listing_id_job_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."job_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_blobs" ADD CONSTRAINT "session_blobs_board_account_id_board_accounts_id_fk" FOREIGN KEY ("board_account_id") REFERENCES "public"."board_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_ref_board_accounts_id_fk" FOREIGN KEY ("session_ref") REFERENCES "public"."board_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_leased_by_worker_nodes_id_fk" FOREIGN KEY ("leased_by") REFERENCES "public"."worker_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_match_uq" ON "applications" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "applications_listing_idx" ON "applications" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "audit_events_user_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "board_accounts_user_board_uq" ON "board_accounts" USING btree ("user_id","board");--> statement-breakpoint
CREATE INDEX "board_accounts_status_idx" ON "board_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candidate_profiles_user_idx" ON "candidate_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_listings_canonical_uq" ON "job_listings" USING btree ("canonical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_listings_board_external_uq" ON "job_listings" USING btree ("board","external_id");--> statement-breakpoint
CREATE INDEX "job_listings_board_idx" ON "job_listings" USING btree ("board");--> statement-breakpoint
CREATE INDEX "job_listings_city_idx" ON "job_listings" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_user_listing_uq" ON "matches" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "matches_user_status_idx" ON "matches" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "matches_score_idx" ON "matches" USING btree ("score");--> statement-breakpoint
CREATE INDEX "raw_listings_board_external_idx" ON "raw_listings" USING btree ("board","external_id");--> statement-breakpoint
CREATE INDEX "raw_listings_listing_idx" ON "raw_listings" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "resumes_user_idx" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resumes_listing_idx" ON "resumes" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "session_blobs_account_idx" ON "session_blobs" USING btree ("board_account_id");--> statement-breakpoint
CREATE INDEX "session_blobs_expires_idx" ON "session_blobs" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_idempotency_uq" ON "tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tasks_status_runafter_idx" ON "tasks" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "tasks_match_idx" ON "tasks" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_nodes_key_uq" ON "worker_nodes" USING btree ("node_key");--> statement-breakpoint
CREATE INDEX "worker_nodes_health_idx" ON "worker_nodes" USING btree ("health");