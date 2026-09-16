DROP TABLE "payment_requests" CASCADE;--> statement-breakpoint
DROP TABLE "plan_purchases" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "plan";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "plan_expires_at";--> statement-breakpoint
DROP TYPE "public"."payment_kind";--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
DROP TYPE "public"."plan";--> statement-breakpoint
DROP TYPE "public"."plan_purchase_status";