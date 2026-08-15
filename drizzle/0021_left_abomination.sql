CREATE TABLE "apply_execution_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text DEFAULT 'paused' NOT NULL,
	"owner" text,
	"executor_id" text,
	"board" "job_board",
	"current_task_id" uuid,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocked_reason" text,
	"background_enabled" boolean DEFAULT true NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apply_execution_runs" ADD CONSTRAINT "apply_execution_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_execution_runs" ADD CONSTRAINT "apply_execution_runs_current_task_id_tasks_id_fk" FOREIGN KEY ("current_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_execution_runs_user_uq" ON "apply_execution_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apply_execution_runs_owner_state_idx" ON "apply_execution_runs" USING btree ("owner","state");--> statement-breakpoint
CREATE INDEX "apply_execution_runs_heartbeat_idx" ON "apply_execution_runs" USING btree ("heartbeat_at");