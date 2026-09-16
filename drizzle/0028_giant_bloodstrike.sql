ALTER TYPE "public"."application_status" ADD VALUE 'verifying' BEFORE 'submitted';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'verifying' BEFORE 'succeeded';