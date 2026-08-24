DROP TABLE "docs_projects";--> statement-breakpoint
DROP TABLE "docs_documents";--> statement-breakpoint
CREATE TABLE "docs_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"storage" text DEFAULT 'db' NOT NULL,
	"git_path" text,
	"base_sha" text,
	"sync_status" text,
	"last_synced_at" integer,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_folder_members" (
	"folder_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"joined_at" integer NOT NULL,
	CONSTRAINT "docs_folder_members_folder_id_user_id_pk" PRIMARY KEY("folder_id","user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_folder_members_folder_user_idx" ON "docs_folder_members" USING btree ("folder_id","user_id");
