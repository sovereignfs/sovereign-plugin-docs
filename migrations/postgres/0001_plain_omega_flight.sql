CREATE TABLE "docs_project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"joined_at" integer NOT NULL,
	CONSTRAINT "docs_project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_project_members_project_user_idx" ON "docs_project_members" USING btree ("project_id","user_id");--> statement-breakpoint
-- Hand-written: seed one owner row per existing project so a project
-- created before this table existed still resolves an owner for the new
-- project-sharing/access-fallback logic.
INSERT INTO "docs_project_members" ("project_id", "user_id", "tenant_id", "role", "invited_by", "joined_at")
SELECT "id", "owner_id", "tenant_id", 'owner', NULL, "created_at"
FROM "docs_projects";