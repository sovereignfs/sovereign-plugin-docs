CREATE TABLE "docs_document_members" (
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"joined_at" integer NOT NULL,
	CONSTRAINT "docs_document_members_document_id_user_id_pk" PRIMARY KEY("document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "docs_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" text,
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
CREATE TABLE "docs_drives" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"branch" text NOT NULL,
	"base_path" text DEFAULT 'docs' NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs_user_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"default_view" text DEFAULT 'markdown' NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_document_members_document_user_idx" ON "docs_document_members" USING btree ("document_id","user_id");