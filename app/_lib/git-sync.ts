'use server';

import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { docsDocuments, docsFolders } from '../_db/schema';
import { getDrive } from './actions';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { buildGitPath, canEditRole } from './document-rules';
import { resolveDocumentRole } from './documents';
import { sanitizeError } from './drive-rules';
import { getGitProvider, GitProviderError, type GitCommit, type GitRepoRef } from './git-providers';

interface DocRow {
  id: string;
  title: string;
  slug: string;
  content: string;
  folderId: string;
  storage: 'db' | 'git';
  gitPath: string | null;
  baseSha: string | null;
}

/**
 * Shared resolution for every git-sync action: loads the document (any
 * member may read revisions; only owner/editor may sync — callers that need
 * write access pass `requireEdit`), the connected drive, and the resolved
 * access token. Returns a discriminated result rather than throwing, so
 * every caller gets the same plain-language "connect a repo" / "reconnect"
 * copy instead of a 500.
 */
async function resolveGitContext(
  documentId: string,
  requireEdit: boolean,
): Promise<
  | { ok: true; doc: DocRow; drive: NonNullable<Awaited<ReturnType<typeof getDrive>>>; token: string }
  | { ok: false; error: string }
> {
  const { db, userId, tenantId } = await getContext();

  const [doc] = await db
    .select({
      id: docsDocuments.id,
      title: docsDocuments.title,
      slug: docsDocuments.slug,
      content: docsDocuments.content,
      folderId: docsDocuments.folderId,
      storage: docsDocuments.storage,
      gitPath: docsDocuments.gitPath,
      baseSha: docsDocuments.baseSha,
    })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
  if (!doc) return { ok: false, error: 'Document not found.' };

  const role = await resolveDocumentRole(db, tenantId, userId, documentId, doc.folderId);
  if (!role) return { ok: false, error: 'Document not found.' };
  if (requireEdit && !canEditRole(role)) {
    return { ok: false, error: "You don't have permission to sync this document." };
  }

  const drive = await getDrive();
  if (!drive || drive.status !== 'connected') {
    return { ok: false, error: 'Connect a Git repository in Docs settings before syncing.' };
  }

  const connection = await sdk.connections.get(drive.connectionId);
  const token = connection?.secretRef ? await sdk.secrets.get(connection.secretRef) : null;
  if (!token) {
    return { ok: false, error: 'Reconnect your Git repository in Docs settings.' };
  }

  return { ok: true, doc, drive, token };
}

async function resolveGitPath(doc: DocRow, drive: { basePath: string }) {
  if (doc.gitPath) return doc.gitPath;
  const { db, tenantId } = await getContext();
  const [folder] = await db
    .select({ slug: docsFolders.slug })
    .from(docsFolders)
    .where(and(eq(docsFolders.id, doc.folderId), eq(docsFolders.tenantId, tenantId)));
  return buildGitPath(drive.basePath, folder?.slug ?? doc.folderId, doc.slug);
}

/**
 * Pushes a document's current content to the connected Git repository — the
 * opt-in tier's "Sync to Git" (D-12). Works the same whether the document is
 * already git-backed (a re-sync) or still local (first sync converts it):
 * SPEC.md's "create-as-git / mark-as-git" and "Sync to Git" are one action
 * here, not two separate steps, so a document is never left half-converted
 * (marked git-backed with nothing actually pushed yet).
 */
export async function syncDocumentToGit(
  documentId: string,
  _prevState: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await resolveGitContext(documentId, true);
  if (!context.ok) return context;
  const { doc, drive, token } = context;

  const gitPath = await resolveGitPath(doc, drive);
  const repo: GitRepoRef = { owner: drive.repoOwner, repo: drive.repoName, branch: drive.branch };
  const provider = getGitProvider('github');
  const { db, tenantId } = await getContext();

  try {
    const result = await provider.publishFile(
      repo,
      {
        path: gitPath,
        content: doc.content,
        baseSha: doc.gitPath ? doc.baseSha : null,
        message: `Update ${doc.title}`,
      },
      { token },
    );

    await db
      .update(docsDocuments)
      .set({
        storage: 'git',
        gitPath,
        baseSha: result.contentSha,
        syncStatus: 'synced',
        lastSyncedAt: now(),
        updatedAt: now(),
      })
      .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));

    await sdk.connections.markUsed(drive.connectionId);
    revalidatePath('/');
    revalidatePath(`/d/${documentId}`);
    return { ok: true, message: 'Synced to Git.' };
  } catch (error) {
    if (error instanceof GitProviderError) {
      if (error.status === 401 || error.status === 403) {
        await sdk.connections.markError(drive.connectionId, {
          error: { message: sanitizeError(error), status: error.status },
          status: 'needs_reauth',
        });
      } else if (error.status === 409 && doc.storage === 'git') {
        // A content conflict is about this document, not the connection —
        // leave the connection's own status alone.
        await db
          .update(docsDocuments)
          .set({ syncStatus: 'conflict', updatedAt: now() })
          .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
      } else {
        // Anything else (404/422/5xx) isn't something a retry of the same
        // sync fixes on its own — surface it on the connection so the
        // Settings page's status badge reflects it instead of silently
        // staying "connected" after a real failure.
        await sdk.connections.markError(drive.connectionId, {
          error: { message: sanitizeError(error), status: error.status },
          status: 'error',
        });
      }
    }
    return { ok: false, error: sanitizeError(error) };
  }
}

export type DocumentRevision = GitCommit;

/** Commit history for a git-backed document's file, newest first. Empty for a local document or on any resolution failure — the revisions panel just shows nothing rather than an error for what's a secondary view. */
export async function listDocumentRevisions(documentId: string): Promise<DocumentRevision[]> {
  const context = await resolveGitContext(documentId, false);
  if (!context.ok || context.doc.storage !== 'git' || !context.doc.gitPath) return [];

  const { drive, token, doc } = context;
  const gitPath = doc.gitPath;
  if (!gitPath) return [];
  const repo: GitRepoRef = { owner: drive.repoOwner, repo: drive.repoName, branch: drive.branch };
  const provider = getGitProvider('github');

  try {
    return await provider.listCommits(repo, gitPath, { token });
  } catch {
    return [];
  }
}

/** A document's content as of a past commit, for the revisions panel's read-only preview. `null` if unreadable. */
export async function getRevisionContent(documentId: string, sha: string): Promise<string | null> {
  const context = await resolveGitContext(documentId, false);
  if (!context.ok || context.doc.storage !== 'git' || !context.doc.gitPath) return null;

  const { drive, token, doc } = context;
  const gitPath = doc.gitPath;
  if (!gitPath) return null;
  const repo: GitRepoRef = { owner: drive.repoOwner, repo: drive.repoName, branch: drive.branch };
  const provider = getGitProvider('github');

  try {
    const file = await provider.getFileContent(repo, gitPath, { token }, sha);
    return file.content;
  } catch {
    return null;
  }
}
