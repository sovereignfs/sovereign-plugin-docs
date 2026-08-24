import { describe, expect, it } from 'vitest';
import { docsDocumentMembers, docsFolderMembers } from '../../_db/schema';

/**
 * `resolveDocumentRole` only ever does `db.select(...).from(table).where(...)`
 * against `docsDocumentMembers`/`docsFolderMembers` — this fake resolves by
 * table identity (the real schema objects, imported above) and returns
 * canned rows, so these tests exercise the fallback logic itself rather than
 * re-verifying drizzle's own WHERE-clause behavior.
 */
function fakeDb(rows: { documentMembers?: unknown[]; folderMembers?: unknown[] }) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === docsDocumentMembers) return rows.documentMembers ?? [];
          if (table === docsFolderMembers) return rows.folderMembers ?? [];
          throw new Error('unexpected table in resolveDocumentRole test fake');
        },
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for the SDK's opaque Db type
  } as any;
}

describe('resolveDocumentRole', () => {
  it('returns the direct document role when a membership row exists', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({ documentMembers: [{ role: 'editor' }] });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'folder-1');
    expect(role).toBe('editor');
  });

  it('falls back to the folder role when the document has no direct membership (the "shared folder" model — every document has a folder)', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({ documentMembers: [], folderMembers: [{ role: 'viewer' }] });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'folder-1');
    expect(role).toBe('viewer');
  });

  it('returns null when neither a direct membership nor a folder membership exists', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({ documentMembers: [], folderMembers: [] });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'folder-1');
    expect(role).toBeNull();
  });

  it('prefers the direct document membership role over the folder fallback when both exist', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({
      documentMembers: [{ role: 'owner' }],
      folderMembers: [{ role: 'viewer' }],
    });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'folder-1');
    expect(role).toBe('owner');
  });
});
