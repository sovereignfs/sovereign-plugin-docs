import { integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Sovereign Docs Postgres schema mirror.
 *
 * Application code should import `db/schema.ts` (which re-exports
 * `app/_db/schema.ts`). This file mirrors the same physical column names
 * and broadly compatible scalar types for Postgres migration generation
 * only — never used by application query code, which stays on the SQLite-
 * typed schema (see docs/plugin-database.md's serialization rule: plain
 * `integer` for booleans/timestamps here, never native Postgres
 * `boolean`/`bigint`; enums are plain `text`, not native pg enums).
 */

export const docsDrives = pgTable('docs_drives', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  connectionId: text('connection_id').notNull(),
  branch: text('branch').notNull(),
  basePath: text('base_path').notNull().default('docs'),
  createdAt: integer('created_at').notNull(),
});

export const docsProjects = pgTable('docs_projects', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const docsDocuments = pgTable('docs_documents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  projectId: text('project_id'),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content').notNull().default(''),
  storage: text('storage').notNull().default('db'),
  gitPath: text('git_path'),
  baseSha: text('base_sha'),
  syncStatus: text('sync_status'),
  lastSyncedAt: integer('last_synced_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const docsUserPrefs = pgTable('docs_user_prefs', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  defaultView: text('default_view').notNull().default('markdown'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const docsDocumentMembers = pgTable(
  'docs_document_members',
  {
    documentId: text('document_id').notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    role: text('role').notNull(),
    invitedBy: text('invited_by'),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.userId] }),
    uniqueIndex('docs_document_members_document_user_idx').on(t.documentId, t.userId),
  ],
);
