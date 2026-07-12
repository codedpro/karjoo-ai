CREATE TYPE "public"."plan_purchase_status" AS ENUM('pending', 'debited', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "plan_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" "plan" NOT NULL,
	"amount_toman" bigint NOT NULL,
	"reference" text NOT NULL,
	"status" "plan_purchase_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "plan_purchases" ADD CONSTRAINT "plan_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_purchases_user_idx" ON "plan_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_purchases_reference_uq" ON "plan_purchases" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_purchases_open_user_uq" ON "plan_purchases" USING btree ("user_id") WHERE status IN ('pending', 'debited');