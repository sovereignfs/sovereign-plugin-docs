import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Runtime query schema for Sovereign Docs.
 *
 * This file intentionally lives under app/ because the Sovereign runtime mounts
 * the plugin app tree into Next routes. Server components/actions must not
 * import runtime query helpers from outside that mounted tree. `db/schema.ts`
 * re-exports this file for tooling (drizzle-kit).
 *
 * `database.isolation: "isolated"` (see manifest.json) — no slug prefix is
 * required, but table names keep the `docs_` prefix from SPEC.md for
 * readability and consistency with the doc's data model table.
 *
 * v0.3 local-first model (SPEC.md "Storage tiers" / "Data model"): a
 * document's canonical Markdown lives in `docs_documents.content` and autosaves
 * there. There is no separate draft table — `docs_drafts` was removed with the
 * git-mandatory draft→publish model it served. Git is an opt-in tier:
 * `docs_documents.storage` is `local` by default and `git` once the document is
 * synced to a connected drive, at which point `git_path`/`base_sha`/
 * `sync_status`/`last_synced_at` track the mirror. `docs_drives` (unchanged)
 * only exists for users who connect a drive; the git token/connection lifecycle
 * remains platform-owned via `sdk.secrets`/`sdk.connections` (no
 * `docs_credentials` table).
 */

export const docsDrives = sqliteTable('docs_drives', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  connectionId: text('connection_id').notNull(),
  branch: text('branch').notNull(),
  basePath: text('base_path').notNull().default('docs'),
  createdAt: integer('created_at').notNull(),
});

export const docsProjects = sqliteTable('docs_projects', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const docsDocuments = sqliteTable('docs_documents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  projectId: text('project_id'),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  /** Canonical Markdown, autosaved directly (no separate draft row). */
  content: text('content').notNull().default(''),
  /** Storage tier: `db` (DB only, counts against the quota) or `git` (mirrored to a drive). */
  storage: text('storage', { enum: ['db', 'git'] })
    .notNull()
    .default('db'),
  /** Path within the connected repo, once git-backed (e.g. `docs/<project>/<slug>.md`). */
  gitPath: text('git_path'),
  /** Last-synced git blob/commit SHA — backs conflict detection on the next sync. */
  baseSha: text('base_sha'),
  /** Sync state for git-backed documents; null for db-only documents. */
  syncStatus: text('sync_status', { enum: ['synced', 'pending', 'conflict'] }),
  lastSyncedAt: integer('last_synced_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const docsUserPrefs = sqliteTable('docs_user_prefs', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  /** Which editor view opens by default. Markdown-first per SPEC.md. */
  defaultView: text('default_view', { enum: ['markdown', 'wysiwyg'] })
    .notNull()
    .default('markdown'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const docsDocumentMembers = sqliteTable(
  'docs_document_members',
  {
    documentId: text('document_id').notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
    invitedBy: text('invited_by'),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.userId] }),
    uniqueIndex('docs_document_members_document_user_idx').on(t.documentId, t.userId),
  ],
);

export const docsTables = {
  docsDrives,
  docsProjects,
  docsDocuments,
  docsUserPrefs,
  docsDocumentMembers,
};

export type DocsDrive = InferSelectModel<typeof docsDrives>;
export type DocsProject = InferSelectModel<typeof docsProjects>;
export type DocsDocument = InferSelectModel<typeof docsDocuments>;
export type DocsUserPrefs = InferSelectModel<typeof docsUserPrefs>;
export type DocsDocumentMember = InferSelectModel<typeof docsDocumentMembers>;
export type NewDocsDrive = InferInsertModel<typeof docsDrives>;
export type NewDocsProject = InferInsertModel<typeof docsProjects>;
export type NewDocsDocument = InferInsertModel<typeof docsDocuments>;
export type NewDocsUserPrefs = InferInsertModel<typeof docsUserPrefs>;
export type NewDocsDocumentMember = InferInsertModel<typeof docsDocumentMembers>;
