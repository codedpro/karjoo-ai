ALTER TYPE "public"."audit_event_type" ADD VALUE 'server_auto_apply_enabled';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'server_auto_apply_disabled';--> statement-breakpoint
CREATE TABLE "user_server_auto_apply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"min_score" double precision DEFAULT 0.7 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_server_auto_apply" ADD CONSTRAINT "user_server_auto_apply_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_server_auto_apply_user_uq" ON "user_server_auto_apply" USING btree ("user_id");