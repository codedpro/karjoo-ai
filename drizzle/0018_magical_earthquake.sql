CREATE TYPE "public"."board_application_status" AS ENUM('pending', 'review', 'interview', 'rejected', 'other');--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'resume_tailor';--> statement-breakpoint
CREATE TABLE "board_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"board" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"company" text,
	"url" text,
	"status_raw" text,
	"status_category" "board_application_status" DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"board" text NOT NULL,
	"data" jsonb NOT NULL,
	"public_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_applications" ADD CONSTRAINT "board_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_profile_snapshots" ADD CONSTRAINT "board_profile_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_applications_user_board_ext_uq" ON "board_applications" USING btree ("user_id","board","external_id");--> statement-breakpoint
CREATE INDEX "board_applications_user_status_idx" ON "board_applications" USING btree ("user_id","status_category");--> statement-breakpoint
CREATE UNIQUE INDEX "board_profile_snapshots_user_board_uq" ON "board_profile_snapshots" USING btree ("user_id","board");