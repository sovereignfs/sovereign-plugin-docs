import { canCreateDbDocument } from './quota';

export const DEFAULT_DOCUMENT_TITLE = 'Untitled document';

/**
 * Slugifies a name into a URL/path-safe segment (lowercase, dashes, no
 * leading/trailing dashes). Falls back to `'untitled'` for input that
 * slugifies to nothing (e.g. all punctuation/emoji).
 */
export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/** Appends a numeric suffix (`-2`, `-3`, ...) until `base` doesn't collide with `existing`. */
export function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/**
 * Builds a git-backed document's path within the repo (SPEC.md "Directory
 * structure") — every document is filed under a folder, so `folderSlug` is
 * always present.
 */
export function buildGitPath(basePath: string, folderSlug: string, slug: string): string {
  return [basePath, folderSlug, `${slug}.md`].join('/');
}

export type DocumentStorage = 'db' | 'git';

export type DocumentStorageDecision =
  | { ok: true; storage: DocumentStorage }
  | { ok: false; error: string };

/**
 * Resolves whether a document-create request may proceed, and under which
 * storage tier (SPEC.md "Document quota" / "Storage tiers"). `requestedStorage`
 * is what the create form asked for:
 * - `'git'` always requires a connected drive, regardless of the db quota.
 * - `'db'` is quota-gated; at the limit, the error differs depending on
 *   whether a drive is already connected (offers git-backed instead, which
 *   doesn't count against the limit) or not (prompts to connect one).
 */
export function resolveDocumentStorage(
  requestedStorage: DocumentStorage,
  dbDocumentCount: number,
  limit: number,
  driveConnected: boolean,
): DocumentStorageDecision {
  if (requestedStorage === 'git') {
    if (!driveConnected) {
      return {
        ok: false,
        error: 'Connect a Git repository before creating a git-backed document.',
      };
    }
    return { ok: true, storage: 'git' };
  }

  if (canCreateDbDocument(dbDocumentCount, limit)) {
    return { ok: true, storage: 'db' };
  }

  if (driveConnected) {
    return {
      ok: false,
      error: `You've reached your ${limit} free documents. Create this one as git-backed instead — it won't count against your limit.`,
    };
  }
  return {
    ok: false,
    error: `You've reached your ${limit} free documents. Connect a Git repository to create more.`,
  };
}

export type DocumentMemberRole = 'owner' | 'editor' | 'viewer';

/** Whether a `docs_document_members` role may edit the document's content/title. */
export function canEditRole(role: DocumentMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/** Type guard for a `docs_document_members.role` value submitted from a share/invite form. */
export function isDocumentMemberRole(value: string): value is DocumentMemberRole {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}
