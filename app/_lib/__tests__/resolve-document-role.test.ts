import { describe, expect, it } from 'vitest';
import { docsDocumentMembers, docsProjectMembers } from '../../_db/schema';

/**
 * `resolveDocumentRole` only ever does `db.select(...).from(table).where(...)`
 * against `docsDocumentMembers`/`docsProjectMembers` — this fake resolves by
 * table identity (the real schema objects, imported above) and returns
 * canned rows, so these tests exercise the fallback logic itself rather than
 * re-verifying drizzle's own WHERE-clause behavior.
 */
function fakeDb(rows: { documentMembers?: unknown[]; projectMembers?: unknown[] }) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === docsDocumentMembers) return rows.documentMembers ?? [];
          if (table === docsProjectMembers) return rows.projectMembers ?? [];
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
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'proj-1');
    expect(role).toBe('editor');
  });

  it('falls back to the project role when the document has no direct membership but is filed under a project (the "shared folder" model)', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({ documentMembers: [], projectMembers: [{ role: 'viewer' }] });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'proj-1');
    expect(role).toBe('viewer');
  });

  it('returns null when there is no direct membership and the document is root-level (no project)', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({ documentMembers: [] });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', null);
    expect(role).toBeNull();
  });

  it('returns null when neither a direct membership nor a project membership exists', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({ documentMembers: [], projectMembers: [] });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'proj-1');
    expect(role).toBeNull();
  });

  it('prefers the direct document membership role over the project fallback when both exist', async () => {
    const { resolveDocumentRole } = await import('../documents');
    const db = fakeDb({
      documentMembers: [{ role: 'owner' }],
      projectMembers: [{ role: 'viewer' }],
    });
    const role = await resolveDocumentRole(db, 'tenant-1', 'user-1', 'doc-1', 'proj-1');
    expect(role).toBe('owner');
  });
});
