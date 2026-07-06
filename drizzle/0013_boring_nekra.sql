CREATE TYPE "public"."payment_kind" AS ENUM('topup', 'plan');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount_toman" bigint NOT NULL,
	"target_plan" "plan",
	"reference_code" text,
	"payer_card_last4" text,
	"note" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"ledger_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_requests_user_created_idx" ON "payment_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_requests_status_idx" ON "payment_requests" USING btree ("status");