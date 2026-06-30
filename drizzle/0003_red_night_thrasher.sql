CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic', 'google');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('topup', 'charge', 'refund', 'grant');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'payg', 'premium');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('match', 'cover_letter', 'resume_parse');--> statement-breakpoint
CREATE TABLE "ai_model_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"input_per_1k_toman" bigint NOT NULL,
	"output_per_1k_toman" bigint NOT NULL,
	"context_window" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model_id" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"upstream_cost_toman" bigint NOT NULL,
	"margin_pct" integer NOT NULL,
	"cost_toman" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_toman" bigint NOT NULL,
	"balance_after_toman" bigint NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance_toman" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "plan" DEFAULT 'payg' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_catalog_model_uq" ON "ai_model_catalog" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "ai_model_catalog_provider_idx" ON "ai_model_catalog" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_model_catalog_enabled_idx" ON "ai_model_catalog" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "usage_records_user_created_idx" ON "usage_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_ai_settings_user_uq" ON "user_ai_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_created_idx" ON "wallet_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_uq" ON "wallets" USING btree ("user_id");