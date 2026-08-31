CREATE TABLE "board_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_account_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"salt" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"username_hint" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_status" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_credentials" ADD CONSTRAINT "board_credentials_board_account_id_board_accounts_id_fk" FOREIGN KEY ("board_account_id") REFERENCES "public"."board_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_credentials_account_uq" ON "board_credentials" USING btree ("board_account_id");