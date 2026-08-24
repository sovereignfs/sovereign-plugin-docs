import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  docsDocumentMembers,
  docsDocuments,
  docsDrives,
  docsProjectMembers,
  docsProjects,
  docsUserPrefs,
} from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

const PLUGIN_ID = 'fs.sovereign.docs';
// v3 (D-14): adds the per-user view preference (docs_user_prefs, D-10) and
// each document's git-sync fields (D-12) to the export, and widens
// documentMembers to a full picture — every member of a document you own,
// not just your own membership row — so an export honestly reflects who a
// document is shared with (SPEC.md "Portability and deletion"). Import stays
// additive-only and still re-normalizes storage to 'db' on every restored
// document (a git mirror is never re-created without reconnecting a drive).
const EXPORT_SCHEMA_VERSION = 3;

/**
 * Registers Docs' export/import/delete participation (RFC 0007 / RFC 0033,
 * RFC 0068). Must be called from a request-scoped Docs route — this repo
 * calls it from `app/layout.tsx`, same as every other request-scoped setup
 * (registrations are in-process and reset on restart).
 */
export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportDocsData);
  await sdk.portability.provideImport(importDocsData);
  await sdk.portability.provideDelete(deleteAllDocsData);
}

// ---- Export shape ----
// A document's canonical Markdown lives in `docs_documents.content`
// (local-first model, SPEC.md v0.3), so it travels with the document row
// here, along with its git-sync state for a git-backed document (D-12) —
// informational only, since a re-import never recreates the remote mirror.
// `docs_drives.connectionId` names an `sdk.connections` record with no
// counterpart on another account or instance, so drive config is exported
// for visibility but not re-created on import (same treatment as
// `documentMembers`, which names other users' accounts).

interface ExportDrive {
  branch: string;
  basePath: string;
  createdAt: number;
}

interface ExportProject {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}

interface ExportDocument {
  id: string;
  projectId: string | null;
  title: string;
  slug: string;
  content: string;
  storage: 'db' | 'git';
  gitPath: string | null;
  syncStatus: 'synced' | 'pending' | 'conflict' | null;
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ExportDocumentMember {
  documentId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  invitedBy: string | null;
  joinedAt: number;
}

interface DocsExportData {
  /** null when the user never connected a git drive. Informational only. */
  drive: ExportDrive | null;
  defaultView: 'markdown' | 'wysiwyg' | null;
  projects: ExportProject[];
  documents: ExportDocument[];
  /**
   * Every member of a document this user owns (so they can see who they've
   * shared it with), plus this user's own membership row on documents owned
   * by others (so they can see what's shared with them). Other users' ids
   * are informational only — never re-created on import (D-13 sharing).
   */
  documentMembers: ExportDocumentMember[];
}

async function exportDocsData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const [driveRows, prefsRows, projectRows, documentRows, ownMemberships] = await Promise.all([
    db
      .select()
      .from(docsDrives)
      .where(and(eq(docsDrives.tenantId, tenantId), eq(docsDrives.userId, userId))),
    db
      .select()
      .from(docsUserPrefs)
      .where(and(eq(docsUserPrefs.tenantId, tenantId), eq(docsUserPrefs.userId, userId))),
    db
      .select()
      .from(docsProjects)
      .where(and(eq(docsProjects.tenantId, tenantId), eq(docsProjects.ownerId, userId))),
    db
      .select()
      .from(docsDocuments)
      .where(and(eq(docsDocuments.tenantId, tenantId), eq(docsDocuments.ownerId, userId))),
    db
      .select()
      .from(docsDocumentMembers)
      .where(
        and(eq(docsDocumentMembers.tenantId, tenantId), eq(docsDocumentMembers.userId, userId)),
      ),
  ]);

  const ownedDocumentIds = documentRows.map((d) => d.id);
  const ownedDocMemberRows =
    ownedDocumentIds.length > 0
      ? await db
          .select()
          .from(docsDocumentMembers)
          .where(
            and(
              eq(docsDocumentMembers.tenantId, tenantId),
              inArray(docsDocumentMembers.documentId, ownedDocumentIds),
            ),
          )
      : [];

  const memberByKey = new Map<string, (typeof ownedDocMemberRows)[number]>();
  for (const row of [...ownedDocMemberRows, ...ownMemberships]) {
    memberByKey.set(`${row.documentId}:${row.userId}`, row);
  }

  const driveRow = driveRows[0];
  const data: DocsExportData = {
    drive: driveRow
      ? { branch: driveRow.branch, basePath: driveRow.basePath, createdAt: driveRow.createdAt }
      : null,
    defaultView: prefsRows[0]?.defaultView ?? null,
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      createdAt: p.createdAt,
    })),
    documents: documentRows.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      title: d.title,
      slug: d.slug,
      content: d.content,
      storage: d.storage,
      gitPath: d.gitPath,
      syncStatus: d.syncStatus,
      lastSyncedAt: d.lastSyncedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    documentMembers: [...memberByKey.values()].map((m) => ({
      documentId: m.documentId,
      userId: m.userId,
      role: m.role,
      invitedBy: m.invitedBy,
      joinedAt: m.joinedAt,
    })),
  };

  const warnings = data.drive
    ? [
        'The connected git drive (repository, branch, credentials) is not re-created on import — reconnect it from Docs settings after importing.',
      ]
    : undefined;

  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data, warnings };
}

// ---- Import ----
// Additive only. `drive` and `documentMembers` (other users' shares) are not
// re-created — a drive needs a live `sdk.connections` grant, and a
// membership row names another user's account with no guaranteed
// counterpart on this instance (silently re-granting access on import would
// also be a real access-control surprise). Every document is restored as a
// **local** document owned by the importing user, with a fresh owner
// membership row (mirrors createDocument) — content is preserved from the
// export, but a git-backed document's remote mirror is not re-created, so it
// starts local until the user reconnects a drive and re-syncs.

function isDocsExportData(value: unknown): value is DocsExportData {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<DocsExportData>;
  return Array.isArray(c.projects) && Array.isArray(c.documents);
}

async function importDocsData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (section.schemaVersion !== EXPORT_SCHEMA_VERSION || !isDocsExportData(section.data)) {
    throw new Error('Docs import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;
  const ts = Math.floor(Date.now() / 1000);

  if (data.defaultView) {
    const [existingPrefs] = await db
      .select({ userId: docsUserPrefs.userId })
      .from(docsUserPrefs)
      .where(and(eq(docsUserPrefs.tenantId, ctx.tenantId), eq(docsUserPrefs.userId, ctx.userId)));
    if (existingPrefs) {
      await db
        .update(docsUserPrefs)
        .set({ defaultView: data.defaultView, updatedAt: ts })
        .where(
          and(eq(docsUserPrefs.tenantId, ctx.tenantId), eq(docsUserPrefs.userId, ctx.userId)),
        );
    } else {
      await db.insert(docsUserPrefs).values({
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        defaultView: data.defaultView,
        createdAt: ts,
        updatedAt: ts,
      });
    }
  }

  const originalProjectIds = new Set(data.projects.map((p) => p.id));

  for (const p of data.projects) {
    const newProjectId = ctx.remapId(p.id);
    await db.insert(docsProjects).values({
      id: newProjectId,
      tenantId: ctx.tenantId,
      ownerId: ctx.userId,
      name: p.name,
      slug: p.slug,
      createdAt: p.createdAt,
    });
    // Every project needs an owner membership row to be reachable at all —
    // getProjectOverview/listDocumentsOverview both read through
    // docs_project_members, not ownerId directly (mirrors the document
    // owner-membership insert below).
    await db.insert(docsProjectMembers).values({
      projectId: newProjectId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: 'owner',
      invitedBy: null,
      joinedAt: ts,
    });
  }

  for (const d of data.documents) {
    const newId = ctx.remapId(d.id);
    await db.insert(docsDocuments).values({
      id: newId,
      tenantId: ctx.tenantId,
      ownerId: ctx.userId,
      projectId: d.projectId && originalProjectIds.has(d.projectId) ? ctx.remapId(d.projectId) : null,
      title: d.title,
      slug: d.slug,
      content: d.content,
      storage: 'db',
      gitPath: null,
      baseSha: null,
      syncStatus: null,
      lastSyncedAt: null,
      createdAt: d.createdAt,
      updatedAt: ts,
    });
    // Every document needs an owner membership row to be reachable at all —
    // getDocumentForEdit/listDocumentsOverview both read through
    // docs_document_members, not ownerId directly.
    await db.insert(docsDocumentMembers).values({
      documentId: newId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: 'owner',
      invitedBy: null,
      joinedAt: ts,
    });
  }
}

// ---- Delete ----

async function deleteAllDocsData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  const errors: string[] = [];
  let deleted = 0;

  // Every document this user has a role on — owned or shared with them.
  const memberships = await db
    .select()
    .from(docsDocumentMembers)
    .where(
      and(eq(docsDocumentMembers.tenantId, ctx.tenantId), eq(docsDocumentMembers.userId, ctx.userId)),
    );

  for (const membership of memberships) {
    const [doc] = await db
      .select({ id: docsDocuments.id, ownerId: docsDocuments.ownerId })
      .from(docsDocuments)
      .where(
        and(eq(docsDocuments.id, membership.documentId), eq(docsDocuments.tenantId, ctx.tenantId)),
      );

    if (!doc) {
      // Dangling membership row with no document behind it — clean it up
      // but don't let it block the rest of deletion.
      await db
        .delete(docsDocumentMembers)
        .where(
          and(
            eq(docsDocumentMembers.tenantId, ctx.tenantId),
            eq(docsDocumentMembers.documentId, membership.documentId),
            eq(docsDocumentMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    if (doc.ownerId !== ctx.userId) {
      // A share on someone else's document (regardless of this user's own
      // role, even 'owner' via D-13's co-owner invite) — just leave it.
      await db
        .delete(docsDocumentMembers)
        .where(
          and(
            eq(docsDocumentMembers.tenantId, ctx.tenantId),
            eq(docsDocumentMembers.documentId, doc.id),
            eq(docsDocumentMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    // This user is the document's actual owner (docs_documents.ownerId) —
    // find someone else to hand it to before leaving, so a shared document
    // survives its owner's account deletion (SPEC.md: "transfers or
    // archives shared documents according to membership").
    const allMembers = await db
      .select()
      .from(docsDocumentMembers)
      .where(
        and(eq(docsDocumentMembers.tenantId, ctx.tenantId), eq(docsDocumentMembers.documentId, doc.id)),
      );
    const successors = allMembers.filter((m) => m.userId !== ctx.userId);

    if (successors.length > 0) {
      const promotee =
        successors.find((m) => m.role === 'owner') ??
        [...successors].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (promotee) {
        await db
          .update(docsDocuments)
          .set({ ownerId: promotee.userId })
          .where(and(eq(docsDocuments.id, doc.id), eq(docsDocuments.tenantId, ctx.tenantId)));
        if (promotee.role !== 'owner') {
          await db
            .update(docsDocumentMembers)
            .set({ role: 'owner' })
            .where(
              and(
                eq(docsDocumentMembers.tenantId, ctx.tenantId),
                eq(docsDocumentMembers.documentId, doc.id),
                eq(docsDocumentMembers.userId, promotee.userId),
              ),
            );
        }
      }
      await db
        .delete(docsDocumentMembers)
        .where(
          and(
            eq(docsDocumentMembers.tenantId, ctx.tenantId),
            eq(docsDocumentMembers.documentId, doc.id),
            eq(docsDocumentMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
    } else {
      // Sole owner, no one else has access — nothing left to preserve.
      await db
        .delete(docsDocumentMembers)
        .where(
          and(eq(docsDocumentMembers.tenantId, ctx.tenantId), eq(docsDocumentMembers.documentId, doc.id)),
        );
      await db
        .delete(docsDocuments)
        .where(and(eq(docsDocuments.id, doc.id), eq(docsDocuments.tenantId, ctx.tenantId)));
      deleted += 1;
    }
  }

  // Every project this user has a role on — owned or shared with them.
  // Mirrors the per-document transfer logic above: a project this user
  // doesn't own just loses their membership row; a project they do own
  // gets handed to a successor member (preferring an existing project
  // owner, else the earliest-joined member) so it survives its owner's
  // account deletion, same as a shared document does.
  const projectMemberships = await db
    .select()
    .from(docsProjectMembers)
    .where(
      and(eq(docsProjectMembers.tenantId, ctx.tenantId), eq(docsProjectMembers.userId, ctx.userId)),
    );

  for (const membership of projectMemberships) {
    const [project] = await db
      .select({ id: docsProjects.id, ownerId: docsProjects.ownerId })
      .from(docsProjects)
      .where(
        and(eq(docsProjects.id, membership.projectId), eq(docsProjects.tenantId, ctx.tenantId)),
      );

    if (!project) {
      // Dangling membership row with no project behind it.
      await db
        .delete(docsProjectMembers)
        .where(
          and(
            eq(docsProjectMembers.tenantId, ctx.tenantId),
            eq(docsProjectMembers.projectId, membership.projectId),
            eq(docsProjectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    if (project.ownerId !== ctx.userId) {
      // A share on someone else's project — just leave it.
      await db
        .delete(docsProjectMembers)
        .where(
          and(
            eq(docsProjectMembers.tenantId, ctx.tenantId),
            eq(docsProjectMembers.projectId, project.id),
            eq(docsProjectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    const allMembers = await db
      .select()
      .from(docsProjectMembers)
      .where(
        and(
          eq(docsProjectMembers.tenantId, ctx.tenantId),
          eq(docsProjectMembers.projectId, project.id),
        ),
      );
    const successors = allMembers.filter((m) => m.userId !== ctx.userId);

    if (successors.length > 0) {
      const promotee =
        successors.find((m) => m.role === 'owner') ??
        [...successors].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (promotee) {
        await db
          .update(docsProjects)
          .set({ ownerId: promotee.userId })
          .where(and(eq(docsProjects.id, project.id), eq(docsProjects.tenantId, ctx.tenantId)));
        if (promotee.role !== 'owner') {
          await db
            .update(docsProjectMembers)
            .set({ role: 'owner' })
            .where(
              and(
                eq(docsProjectMembers.tenantId, ctx.tenantId),
                eq(docsProjectMembers.projectId, project.id),
                eq(docsProjectMembers.userId, promotee.userId),
              ),
            );
        }
      }
      await db
        .delete(docsProjectMembers)
        .where(
          and(
            eq(docsProjectMembers.tenantId, ctx.tenantId),
            eq(docsProjectMembers.projectId, project.id),
            eq(docsProjectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
    } else {
      // Sole owner, no one else has access — nothing left to preserve.
      // Reparent any documents still filed under it to root level first,
      // so deleting the project doesn't leave a document pointing at a
      // projectId that no longer exists (invisible: not on the root
      // documents list, and its own project page 404s).
      await db
        .update(docsDocuments)
        .set({ projectId: null })
        .where(
          and(eq(docsDocuments.tenantId, ctx.tenantId), eq(docsDocuments.projectId, project.id)),
        );
      await db
        .delete(docsProjectMembers)
        .where(
          and(
            eq(docsProjectMembers.tenantId, ctx.tenantId),
            eq(docsProjectMembers.projectId, project.id),
          ),
        );
      await db
        .delete(docsProjects)
        .where(and(eq(docsProjects.id, project.id), eq(docsProjects.tenantId, ctx.tenantId)));
      deleted += 1;
    }
  }

  const driveRows = await db
    .select()
    .from(docsDrives)
    .where(and(eq(docsDrives.tenantId, ctx.tenantId), eq(docsDrives.userId, ctx.userId)));
  for (const drive of driveRows) {
    try {
      await sdk.connections.disconnect(drive.connectionId);
    } catch {
      // Best-effort — the local docs_drives row is still removed below even
      // if the platform-level connection disconnect fails; a stray
      // connection record needing manual cleanup is preferable to blocking
      // the rest of this user's deletion.
      errors.push('Could not disconnect the Git repository connection — it may need manual cleanup.');
    }
  }
  await db
    .delete(docsDrives)
    .where(and(eq(docsDrives.tenantId, ctx.tenantId), eq(docsDrives.userId, ctx.userId)));
  deleted += driveRows.length;

  const prefsRows = await db
    .select({ userId: docsUserPrefs.userId })
    .from(docsUserPrefs)
    .where(and(eq(docsUserPrefs.tenantId, ctx.tenantId), eq(docsUserPrefs.userId, ctx.userId)));
  await db
    .delete(docsUserPrefs)
    .where(and(eq(docsUserPrefs.tenantId, ctx.tenantId), eq(docsUserPrefs.userId, ctx.userId)));
  deleted += prefsRows.length;

  return { deleted, errors: errors.length > 0 ? errors : undefined };
}
