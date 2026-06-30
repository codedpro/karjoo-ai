CREATE TYPE "public"."worker_command" AS ENUM('update', 'restart');--> statement-breakpoint
CREATE TYPE "public"."worker_command_status" AS ENUM('pending', 'acked', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "worker_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"command" "worker_command" NOT NULL,
	"payload" jsonb,
	"status" "worker_command_status" DEFAULT 'pending' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
ALTER TABLE "worker_nodes" ADD COLUMN "credential_hash" text;--> statement-breakpoint
ALTER TABLE "worker_nodes" ADD COLUMN "enrollment_token_hash" text;--> statement-breakpoint
ALTER TABLE "worker_nodes" ADD COLUMN "agent_version" text;--> statement-breakpoint
ALTER TABLE "worker_nodes" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "worker_nodes" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worker_assignments" ADD CONSTRAINT "worker_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_assignments" ADD CONSTRAINT "worker_assignments_node_id_worker_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."worker_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_commands" ADD CONSTRAINT "worker_commands_node_id_worker_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."worker_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_assignments_user_node_uq" ON "worker_assignments" USING btree ("user_id","node_id");--> statement-breakpoint
CREATE INDEX "worker_assignments_node_idx" ON "worker_assignments" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "worker_assignments_user_idx" ON "worker_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "worker_commands_node_status_idx" ON "worker_commands" USING btree ("node_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_nodes_credential_uq" ON "worker_nodes" USING btree ("credential_hash") WHERE credential_hash IS NOT NULL;