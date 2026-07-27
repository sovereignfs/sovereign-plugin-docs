'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { docsDocumentMembers, docsDocuments, docsProjects } from '../_db/schema';
import { getDrive, type DriveView } from './actions';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import {
  DEFAULT_DOCUMENT_TITLE,
  buildGitPath,
  canEditRole,
  resolveDocumentStorage,
  slugify,
  uniqueSlug,
} from './document-rules';
import { getFreeDocLimit } from './quota';

export type { ActionResult };

export async function createProject(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a project name.' };

  const existing = await db
    .select({ slug: docsProjects.slug })
    .from(docsProjects)
    .where(and(eq(docsProjects.tenantId, tenantId), eq(docsProjects.ownerId, userId)));

  const slug = uniqueSlug(
    slugify(name),
    new Set(existing.map((row) => row.slug)),
  );

  await db.insert(docsProjects).values({
    id: randomUUID(),
    tenantId,
    ownerId: userId,
    name,
    slug,
    createdAt: now(),
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
  const projectIdInput = String(formData.get('projectId') ?? '').trim();
  const requestedStorage = formData.get('storage') === 'git' ? 'git' : 'db';

  let project: { id: string; slug: string } | null = null;
  if (projectIdInput) {
    const rows = await db
      .select({ id: docsProjects.id, slug: docsProjects.slug })
      .from(docsProjects)
      .where(
        and(
          eq(docsProjects.id, projectIdInput),
          eq(docsProjects.tenantId, tenantId),
          eq(docsProjects.ownerId, userId),
        ),
      );
    project = rows[0] ?? null;
    if (!project) return { ok: false, error: 'Project not found.' };
  }

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

  const slugFilter = project
    ? and(
        eq(docsDocuments.tenantId, tenantId),
        eq(docsDocuments.ownerId, userId),
        eq(docsDocuments.projectId, project.id),
      )
    : and(
        eq(docsDocuments.tenantId, tenantId),
        eq(docsDocuments.ownerId, userId),
        isNull(docsDocuments.projectId),
      );
  const existingSlugs = await db
    .select({ slug: docsDocuments.slug })
    .from(docsDocuments)
    .where(slugFilter);
  const slug = uniqueSlug(slugify(title), new Set(existingSlugs.map((row) => row.slug)));

  const id = randomUUID();
  const ts = now();
  const isGit = decision.storage === 'git';

  await db.insert(docsDocuments).values({
    id,
    tenantId,
    ownerId: userId,
    projectId: project?.id ?? null,
    title,
    slug,
    content: '',
    storage: decision.storage,
    gitPath: isGit && drive ? buildGitPath(drive.basePath, project?.slug ?? null, slug) : null,
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
  projects: { id: string; name: string; slug: string }[];
  documents: {
    id: string;
    title: string;
    slug: string;
    projectId: string | null;
    storage: 'db' | 'git';
    /** Whether this user owns the document (`docs_documents.ownerId`) vs. has it shared with them (D-13). */
    owned: boolean;
  }[];
  dbCount: number;
  limit: number;
  driveConnected: boolean;
}

/**
 * Reads the current user's projects/documents plus the quota state, for the
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
 */
export async function listDocumentsOverview(drive: DriveView | null): Promise<DocumentsOverview> {
  const { db, userId, tenantId } = await getContext();

  const [projects, memberships] = await Promise.all([
    db
      .select({ id: docsProjects.id, name: docsProjects.name, slug: docsProjects.slug })
      .from(docsProjects)
      .where(and(eq(docsProjects.tenantId, tenantId), eq(docsProjects.ownerId, userId))),
    db
      .select({ documentId: docsDocumentMembers.documentId })
      .from(docsDocumentMembers)
      .where(
        and(eq(docsDocumentMembers.tenantId, tenantId), eq(docsDocumentMembers.userId, userId)),
      ),
  ]);

  const documentIds = memberships.map((membership) => membership.documentId);
  const documentRows =
    documentIds.length > 0
      ? await db
          .select({
            id: docsDocuments.id,
            title: docsDocuments.title,
            slug: docsDocuments.slug,
            projectId: docsDocuments.projectId,
            storage: docsDocuments.storage,
            ownerId: docsDocuments.ownerId,
          })
          .from(docsDocuments)
          .where(
            and(eq(docsDocuments.tenantId, tenantId), inArray(docsDocuments.id, documentIds)),
          )
      : [];

  const documents = documentRows.map(({ ownerId, ...doc }) => ({
    ...doc,
    owned: ownerId === userId,
  }));
  const dbCount = documents.filter((doc) => doc.owned && doc.storage === 'db').length;
  const limit = await getFreeDocLimit();

  return {
    projects,
    documents,
    dbCount,
    limit,
    driveConnected: drive?.status === 'connected',
  };
}

export interface ProjectOverview {
  project: { id: string; name: string; slug: string };
  documents: { id: string; title: string; storage: 'db' | 'git' }[];
}

/**
 * Reads one project and the documents filed under it, for the project
 * detail route (`/docs/projects/[projectId]`, D-09). Returns `null` if the
 * project doesn't exist, isn't in this tenant, or isn't owned by the
 * current user — the route 404s on that, same as `getDocumentForEdit`.
 */
export async function getProjectOverview(projectId: string): Promise<ProjectOverview | null> {
  const { db, userId, tenantId } = await getContext();

  const [project] = await db
    .select({ id: docsProjects.id, name: docsProjects.name, slug: docsProjects.slug })
    .from(docsProjects)
    .where(
      and(
        eq(docsProjects.id, projectId),
        eq(docsProjects.tenantId, tenantId),
        eq(docsProjects.ownerId, userId),
      ),
    );
  if (!project) return null;

  const documents = await db
    .select({ id: docsDocuments.id, title: docsDocuments.title, storage: docsDocuments.storage })
    .from(docsDocuments)
    .where(
      and(
        eq(docsDocuments.tenantId, tenantId),
        eq(docsDocuments.ownerId, userId),
        eq(docsDocuments.projectId, projectId),
      ),
    );

  return { project, documents };
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
 * Loads a document for the editor route, scoped by `docs_document_members`
 * rather than `ownerId` directly — a shared document's viewers/editors
 * (D-13) go through the same membership row an owner's own auto-inserted
 * row does. Returns `null` if the document doesn't exist, isn't in this
 * tenant, or the current user has no membership row on it (→ 404).
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
    })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
  if (!doc) return null;

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
  if (!membership) return null;

  return { ...doc, role: membership.role, canEdit: canEditRole(membership.role) };
}

/**
 * Autosave endpoint for the editor (D-08). Not `useActionState`-shaped
 * (no `_prevState`) — called directly from a debounced client effect, same
 * pattern as Plainwrite's `saveDraft`. Only updates local state; syncing a
 * git-backed document's content to the remote repo is D-12's "Sync to Git".
 */
export async function saveDocument(documentId: string, formData: FormData): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

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
  if (!membership || !canEditRole(membership.role)) {
    return { ok: false, error: "You don't have permission to edit this document." };
  }

  const [existing] = await db
    .select({ storage: docsDocuments.storage })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
  if (!existing) return { ok: false, error: 'Document not found.' };

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
