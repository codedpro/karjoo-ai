ALTER TYPE "public"."plan" ADD VALUE 'pro';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'max';--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE 'maxplus';--> statement-breakpoint
CREATE TABLE "app_ai_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" text NOT NULL,
	"upstream_cost_toman" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text DEFAULT 'global' NOT NULL,
	"ai_maintenance_manual" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
CREATE UNIQUE INDEX "app_ai_budget_period_uq" ON "app_ai_budget" USING btree ("period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_key_uq" ON "app_settings" USING btree ("key");