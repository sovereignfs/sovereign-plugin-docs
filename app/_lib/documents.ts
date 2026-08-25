'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { docsDocumentMembers, docsDocuments, docsFolderMembers, docsFolders } from '../_db/schema';
import { getDrive, type DriveView } from './actions';
import type { ActionResult, Db } from './context';
import { getContext, now } from './context';
import {
  DEFAULT_DOCUMENT_TITLE,
  buildGitPath,
  canEditRole,
  resolveDocumentStorage,
  slugify,
  uniqueSlug,
  type DocumentMemberRole,
} from './document-rules';
import { canEditFolderRole, type FolderMemberRole } from './folder-rules';
import { newId } from './ids';
import { getFreeDocLimit } from './quota';

export type { ActionResult };

/**
 * Resolves the current user's role on a folder via `docs_folder_members`.
 * `docs_folders.ownerId` is no longer consulted directly — every folder
 * (including ones created before this table existed) has a matching owner
 * membership row via the creation-time insert below or the migration's
 * backfill, so the membership table is the single source of truth.
 */
async function resolveFolderRole(
  db: Db,
  tenantId: string,
  userId: string,
  folderId: string,
): Promise<FolderMemberRole | null> {
  const [membership] = await db
    .select({ role: docsFolderMembers.role })
    .from(docsFolderMembers)
    .where(
      and(
        eq(docsFolderMembers.folderId, folderId),
        eq(docsFolderMembers.tenantId, tenantId),
        eq(docsFolderMembers.userId, userId),
      ),
    );
  return membership?.role ?? null;
}

/**
 * Resolves the current user's effective role on a document: a direct
 * `docs_document_members` row, else their `docs_folder_members` role for
 * the folder it's filed under (the "shared folder" model: sharing a folder
 * grants access to every document already filed under it, at that role,
 * with no separate per-document share required). Every document has a
 * folder, so this always falls through to the folder-role check when
 * there's no direct membership. This does **not** extend to managing the
 * document's own sharing — that stays gated to a direct
 * `docs_document_members` owner row, see `sharing.ts`'s `requireOwner`.
 */
export async function resolveDocumentRole(
  db: Db,
  tenantId: string,
  userId: string,
  documentId: string,
  folderId: string,
): Promise<DocumentMemberRole | null> {
  const [membership] = await db
    .select({ role: docsDocumentMembers.role })
    .from(docsDocumentMembers)
    .where(
      and(
        eq(docsDocumentMembers.documentId, documentId),
        eq(docsDocumentMembers.tenantId, tenantId),
        eq(docsDocumentMembers.userId, userId),
      ),
    );
  if (membership) return membership.role;

  return resolveFolderRole(db, tenantId, userId, folderId);
}

export async function createFolder(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a folder name.' };

  const existing = await db
    .select({ slug: docsFolders.slug })
    .from(docsFolders)
    .where(and(eq(docsFolders.tenantId, tenantId), eq(docsFolders.ownerId, userId)));

  const slug = uniqueSlug(
    slugify(name),
    new Set(existing.map((row) => row.slug)),
  );

  const id = newId();
  const ts = now();

  await db.insert(docsFolders).values({
    id,
    tenantId,
    ownerId: userId,
    name,
    slug,
    createdAt: ts,
  });

  await db.insert(docsFolderMembers).values({
    folderId: id,
    userId,
    tenantId,
    role: 'owner',
    invitedBy: null,
    joinedAt: ts,
  });

  revalidatePath('/');
  return { ok: true };
}

export async function createDocument(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const title = String(formData.get('title') ?? '').trim() || DEFAULT_DOCUMENT_TITLE;
  const folderIdInput = String(formData.get('folderId') ?? '').trim();
  const requestedStorage = formData.get('storage') === 'git' ? 'git' : 'db';

  if (!folderIdInput) return { ok: false, error: 'Choose a folder.' };
  const [folder] = await db
    .select({ id: docsFolders.id, slug: docsFolders.slug })
    .from(docsFolders)
    .where(and(eq(docsFolders.id, folderIdInput), eq(docsFolders.tenantId, tenantId)));
  if (!folder) return { ok: false, error: 'Folder not found.' };

  const role = await resolveFolderRole(db, tenantId, userId, folder.id);
  if (!role || !canEditFolderRole(role)) return { ok: false, error: 'Folder not found.' };

  const drive = await getDrive();
  const driveConnected = drive?.status === 'connected';

  const dbCount = (
    await db
      .select({ id: docsDocuments.id })
      .from(docsDocuments)
      .where(
        and(
          eq(docsDocuments.tenantId, tenantId),
          eq(docsDocuments.ownerId, userId),
          eq(docsDocuments.storage, 'db'),
        ),
      )
  ).length;

  const limit = await getFreeDocLimit();
  const decision = resolveDocumentStorage(requestedStorage, dbCount, limit, driveConnected);
  if (!decision.ok) return decision;

  // A folder's slug is scoped across every contributor (not just this
  // user's own documents) now that folder sharing lets more than one owner
  // ever create documents in it — a collision would mean two documents
  // racing for the same git path (`buildGitPath`) once synced.
  const existingSlugs = await db
    .select({ slug: docsDocuments.slug })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.tenantId, tenantId), eq(docsDocuments.folderId, folder.id)));
  const slug = uniqueSlug(slugify(title), new Set(existingSlugs.map((row) => row.slug)));

  const id = newId();
  const ts = now();
  const isGit = decision.storage === 'git';

  await db.insert(docsDocuments).values({
    id,
    tenantId,
    ownerId: userId,
    folderId: folder.id,
    title,
    slug,
    content: '',
    storage: decision.storage,
    gitPath: isGit && drive ? buildGitPath(drive.basePath, folder.slug, slug) : null,
    baseSha: null,
    syncStatus: isGit ? 'pending' : null,
    lastSyncedAt: null,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(docsDocumentMembers).values({
    documentId: id,
    userId,
    tenantId,
    role: 'owner',
    invitedBy: null,
    joinedAt: ts,
  });

  revalidatePath('/');
  return { ok: true };
}

export interface DocumentsOverview {
  folders: { id: string; name: string; slug: string; role: FolderMemberRole }[];
  documents: {
    id: string;
    title: string;
    slug: string;
    storage: 'db' | 'git';
    /** Whether this user owns the document (`docs_documents.ownerId`) vs. has it shared with them (D-13). */
    owned: boolean;
  }[];
  dbCount: number;
  limit: number;
  driveConnected: boolean;
}

/**
 * Reads the current user's folders/documents plus the quota state, for the
 * plugin index page. `drive` is passed in (rather than fetched here) so a
 * caller that already has it (e.g. the index page) doesn't pay for a second
 * `sdk.connections` round trip.
 *
 * Documents are read through `docs_document_members` (which already holds
 * the owner's own auto-inserted row) rather than filtering `docs_documents`
 * by `ownerId` — otherwise a document shared with this user (D-13) would
 * have no way to ever surface here, the exact "data that exists but is
 * filtered out of every view" trap. `owned` disambiguates a membership row
 * from actual ownership: `docs_documents.ownerId` is fixed at creation, but
 * a shared member can hold any role (including 'owner') without becoming
 * the row's owner.
 *
 * Folders are read the same way through `docs_folder_members`, so a folder
 * shared with this user surfaces here too, each carrying its resolved
 * `role` for the home page's "My folders"/"Shared with me" split.
 * `documents` only ever holds documents individually shared with this user
 * (D-13) — every document now always has a folder, so an owned document is
 * never shown here; it's reachable by opening its folder instead. A
 * document reachable purely via folder role (the "shared folder" fallback
 * in `resolveDocumentRole`) stays out of this list too, for the same
 * reason.
 */
export async function listDocumentsOverview(drive: DriveView | null): Promise<DocumentsOverview> {
  const { db, userId, tenantId } = await getContext();

  const [folderMemberships, documentMemberships] = await Promise.all([
    db
      .select({ folderId: docsFolderMembers.folderId, role: docsFolderMembers.role })
      .from(docsFolderMembers)
      .where(and(eq(docsFolderMembers.tenantId, tenantId), eq(docsFolderMembers.userId, userId))),
    db
      .select({ documentId: docsDocumentMembers.documentId })
      .from(docsDocumentMembers)
      .where(
        and(eq(docsDocumentMembers.tenantId, tenantId), eq(docsDocumentMembers.userId, userId)),
      ),
  ]);

  const folderIds = folderMemberships.map((membership) => membership.folderId);
  const folderRows =
    folderIds.length > 0
      ? await db
          .select({ id: docsFolders.id, name: docsFolders.name, slug: docsFolders.slug })
          .from(docsFolders)
          .where(and(eq(docsFolders.tenantId, tenantId), inArray(docsFolders.id, folderIds)))
      : [];
  const folderRoleById = new Map(folderMemberships.map((m) => [m.folderId, m.role]));
  const folders = folderRows.map((folder) => ({
    ...folder,
    // Always present — every row here came from a membership row above.
    role: folderRoleById.get(folder.id) ?? 'viewer',
  }));

  const documentIds = documentMemberships.map((membership) => membership.documentId);
  const documentRows =
    documentIds.length > 0
      ? await db
          .select({
            id: docsDocuments.id,
            title: docsDocuments.title,
            slug: docsDocuments.slug,
            storage: docsDocuments.storage,
            ownerId: docsDocuments.ownerId,
          })
          .from(docsDocuments)
          .where(
            and(eq(docsDocuments.tenantId, tenantId), inArray(docsDocuments.id, documentIds)),
          )
      : [];

  const documents = documentRows
    .map(({ ownerId, ...doc }) => ({ ...doc, owned: ownerId === userId }))
    .filter((doc) => !doc.owned);
  const dbCount = documentRows.filter(
    (doc) => doc.ownerId === userId && doc.storage === 'db',
  ).length;
  const limit = await getFreeDocLimit();

  return {
    folders,
    documents,
    dbCount,
    limit,
    driveConnected: drive?.status === 'connected',
  };
}

export interface FolderOverview {
  folder: { id: string; name: string; slug: string; role: FolderMemberRole };
  documents: { id: string; title: string; storage: 'db' | 'git' }[];
  /** Whether the current user's folder role permits creating/editing documents here. */
  canEdit: boolean;
}

/**
 * Reads one folder and the documents filed under it, for the folder
 * detail route (`/docs/f/[folderId]`, D-09). Returns `null` if the
 * folder doesn't exist, isn't in this tenant, or the current user has no
 * `docs_folder_members` role on it — the route 404s on that, same as
 * `getDocumentForEdit`. Documents are **not** filtered by `ownerId` here — a
 * shared editor/viewer needs to see every document filed under the folder,
 * not just ones they personally created.
 */
export async function getFolderOverview(folderId: string): Promise<FolderOverview | null> {
  const { db, userId, tenantId } = await getContext();

  const [folder] = await db
    .select({ id: docsFolders.id, name: docsFolders.name, slug: docsFolders.slug })
    .from(docsFolders)
    .where(and(eq(docsFolders.id, folderId), eq(docsFolders.tenantId, tenantId)));
  if (!folder) return null;

  const role = await resolveFolderRole(db, tenantId, userId, folderId);
  if (!role) return null;

  const documents = await db
    .select({ id: docsDocuments.id, title: docsDocuments.title, storage: docsDocuments.storage })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.tenantId, tenantId), eq(docsDocuments.folderId, folderId)));

  return { folder: { ...folder, role }, documents, canEdit: canEditFolderRole(role) };
}

export interface DocumentEditorData {
  id: string;
  title: string;
  slug: string;
  content: string;
  storage: 'db' | 'git';
  syncStatus: 'synced' | 'pending' | 'conflict' | null;
  /** The current user's `docs_document_members` role — 'owner' gates the Share dialog (D-13). */
  role: 'owner' | 'editor' | 'viewer';
  /** Whether the current user's membership role permits editing (owner/editor, not viewer). */
  canEdit: boolean;
}

/**
 * Loads a document for the editor route, scoped by `resolveDocumentRole`
 * rather than `ownerId` directly — a shared document's viewers/editors
 * (D-13), or a member of the folder it's filed under (the "shared folder"
 * fallback), go through the same resolution an owner's own auto-inserted
 * `docs_document_members` row does. Returns `null` if the document doesn't
 * exist, isn't in this tenant, or the current user has no resolvable role
 * on it (→ 404).
 */
export async function getDocumentForEdit(documentId: string): Promise<DocumentEditorData | null> {
  const { db, userId, tenantId } = await getContext();

  const [doc] = await db
    .select({
      id: docsDocuments.id,
      title: docsDocuments.title,
      slug: docsDocuments.slug,
      content: docsDocuments.content,
      storage: docsDocuments.storage,
      syncStatus: docsDocuments.syncStatus,
      folderId: docsDocuments.folderId,
    })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
  if (!doc) return null;

  const role = await resolveDocumentRole(db, tenantId, userId, documentId, doc.folderId);
  if (!role) return null;

  const { folderId: _folderId, ...docFields } = doc;
  return { ...docFields, role, canEdit: canEditRole(role) };
}

/**
 * Autosave endpoint for the editor (D-08). Not `useActionState`-shaped
 * (no `_prevState`) — called directly from a debounced client effect, same
 * pattern as Plainwrite's `saveDraft`. Only updates local state; syncing a
 * git-backed document's content to the remote repo is D-12's "Sync to Git".
 */
export async function saveDocument(documentId: string, formData: FormData): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const [existing] = await db
    .select({ storage: docsDocuments.storage, folderId: docsDocuments.folderId })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
  if (!existing) return { ok: false, error: 'Document not found.' };

  const role = await resolveDocumentRole(db, tenantId, userId, documentId, existing.folderId);
  if (!role || !canEditRole(role)) {
    return { ok: false, error: "You don't have permission to edit this document." };
  }

  const title = String(formData.get('title') ?? '').trim() || DEFAULT_DOCUMENT_TITLE;
  const content = String(formData.get('content') ?? '');

  await db
    .update(docsDocuments)
    .set({
      title,
      content,
      updatedAt: now(),
      // A git-backed document's remote copy only updates on an explicit Sync
      // to Git (D-12) — autosave here only ever touches the local DB row, so
      // every autosave of a git-backed document leaves it needing a re-sync.
      ...(existing.storage === 'git' ? { syncStatus: 'pending' as const } : {}),
    })
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));

  revalidatePath('/');
  return { ok: true };
}
