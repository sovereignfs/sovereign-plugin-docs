import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionContext,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition =
  | { kind: 'eq'; key: string; value: unknown }
  | { kind: 'and'; conditions: Condition[] }
  | { kind: 'or'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
    or: (...conditions: Condition[]): Condition => ({ kind: 'or', conditions }),
    inArray: (column: { name: string }, values: unknown[]): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value: values,
    }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') {
    if (Array.isArray(condition.value)) return condition.value.includes(row[condition.key]);
    return row[condition.key] === condition.value;
  }
  if (condition.kind === 'and') return condition.conditions.every((c) => matches(row, c));
  return condition.conditions.some((c) => matches(row, c));
}

const capturedExporter = { fn: null as ((ctx: ExportContext) => Promise<PluginExportSection>) | null };
const capturedImporter = {
  fn: null as ((section: PluginExportSection, ctx: ImportContext) => Promise<void>) | null,
};
const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<{ deleted: number; errors?: string[] }>) | null,
};

const disconnectMock = vi.fn(async () => {});

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    connections: { disconnect: disconnectMock },
    portability: {
      provideExport: vi.fn(async (fn: typeof capturedExporter.fn) => {
        capturedExporter.fn = fn;
      }),
      provideImport: vi.fn(async (fn: typeof capturedImporter.fn) => {
        capturedImporter.fn = fn;
      }),
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  docs_drives: Row[];
  docs_folders: Row[];
  docs_documents: Row[];
  docs_user_prefs: Row[];
  docs_document_members: Row[];
  docs_folder_members: Row[];
}

let store: Store = {
  docs_drives: [],
  docs_folders: [],
  docs_documents: [],
  docs_user_prefs: [],
  docs_document_members: [],
  docs_folder_members: [],
};

function resetStore() {
  store = {
    docs_drives: [],
    docs_folders: [],
    docs_documents: [],
    docs_user_prefs: [],
    docs_document_members: [],
    docs_folder_members: [],
  };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where: async (condition?: Condition) => {
            const rows = (store[tableName] ?? []).filter((row) => matches(row, condition));
            if (!columns) return rows;
            return rows.map((row) => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) projected[key] = row[key];
              return projected;
            });
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Row) => {
        (store[tableName] ??= []).push(row);
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (patch: Row) => ({
        where: async (condition?: Condition) => {
          store[tableName] = (store[tableName] ?? []).map((row) =>
            matches(row, condition) ? { ...row, ...patch } : row,
          );
        },
      }),
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability export', () => {
  it("exports only the user's own folders and documents (content inline), the user's view preference, and every member of a document they own, with a warning about the drive", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.docs_drives = [
      { userId: 'u1', tenantId: 't1', connectionId: 'conn-1', branch: 'main', basePath: 'docs', createdAt: 1 },
    ];
    store.docs_user_prefs = [{ userId: 'u1', tenantId: 't1', defaultView: 'wysiwyg', createdAt: 1, updatedAt: 1 }];
    store.docs_folders = [
      { id: 'folder-1', tenantId: 't1', ownerId: 'u1', name: 'Handbook', slug: 'handbook', createdAt: 1 },
      { id: 'folder-2', tenantId: 't1', ownerId: 'other', name: 'Not mine', slug: 'not-mine', createdAt: 1 },
    ];
    store.docs_documents = [
      { id: 'doc-1', tenantId: 't1', ownerId: 'u1', folderId: 'folder-1', title: 'Onboarding', slug: 'onboarding', content: 'Hello', storage: 'db', gitPath: null, baseSha: null, syncStatus: null, lastSyncedAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'doc-2', tenantId: 't1', ownerId: 'other', folderId: 'folder-2', title: 'Not mine', slug: 'not-mine', content: 'nope', storage: 'db', gitPath: null, baseSha: null, syncStatus: null, lastSyncedAt: null, createdAt: 1, updatedAt: 1 },
    ];
    store.docs_document_members = [
      { documentId: 'doc-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { documentId: 'doc-1', userId: 'shared-with', tenantId: 't1', role: 'viewer', invitedBy: 'u1', joinedAt: 2 },
      { documentId: 'doc-2', userId: 'other', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];

    const section = await capturedExporter.fn?.({
      userId: 'u1',
      tenantId: 't1',
      options: { includeFiles: true },
    });
    expect(section).toBeDefined();
    expect((section as PluginExportSection).schemaVersion).toBe(4);

    const data = (section as PluginExportSection).data as {
      drive: { branch: string } | null;
      defaultView: string | null;
      folders: { id: string }[];
      documents: { id: string; content: string; storage: string }[];
      documentMembers: { documentId: string; userId: string; role: string }[];
    };
    expect(data.drive?.branch).toBe('main');
    expect(data.defaultView).toBe('wysiwyg');
    expect(data.folders.map((f) => f.id)).toEqual(['folder-1']);
    expect(data.documents.map((d) => d.id)).toEqual(['doc-1']);
    expect(data.documents[0]).toMatchObject({ content: 'Hello', storage: 'db' });
    // Every member of the owned document doc-1 is included, not just the exporting user's own row.
    expect(data.documentMembers.map((m) => `${m.documentId}:${m.userId}:${m.role}`).sort()).toEqual(
      ['doc-1:shared-with:viewer', 'doc-1:u1:owner'].sort(),
    );
    expect((section as PluginExportSection).warnings?.length).toBeGreaterThan(0);
  });
});

describe('portability import', () => {
  it('remaps a document to its folder, scopes it to the importing user as a local doc with an owner membership row, without re-creating the drive or preference other users hold', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.docs',
      schemaVersion: 4,
      data: {
        drive: { branch: 'main', basePath: 'docs', createdAt: 1 },
        defaultView: 'markdown',
        folders: [{ id: 'src-folder-1', name: 'Handbook', slug: 'handbook', createdAt: 1 }],
        documents: [
          { id: 'src-doc-1', folderId: 'src-folder-1', title: 'Onboarding', slug: 'onboarding', content: 'Hello', storage: 'git', gitPath: 'docs/handbook/onboarding.md', syncStatus: 'synced', lastSyncedAt: 1, createdAt: 1, updatedAt: 1 },
        ],
        documentMembers: [{ documentId: 'src-doc-1', userId: 'u1', role: 'owner', invitedBy: null, joinedAt: 1 }],
      },
    };

    await capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId: (id) => `new-${id}` });

    expect(store.docs_folders).toEqual([
      expect.objectContaining({ id: 'new-src-folder-1', ownerId: 'u2', tenantId: 't1' }),
    ]);
    // An owner membership row is created — without it the folder would be
    // unreachable (getFolderOverview/listDocumentsOverview both read
    // through docs_folder_members, not ownerId directly).
    expect(store.docs_folder_members).toEqual([
      expect.objectContaining({ folderId: 'new-src-folder-1', userId: 'u2', role: 'owner' }),
    ]);
    // A git-backed document is imported as local (its remote mirror is not re-created), content preserved.
    expect(store.docs_documents).toEqual([
      expect.objectContaining({
        id: 'new-src-doc-1',
        folderId: 'new-src-folder-1',
        ownerId: 'u2',
        content: 'Hello',
        storage: 'db',
        gitPath: null,
        syncStatus: null,
      }),
    ]);
    // An owner membership row is created — without it the document would be unreachable
    // (getDocumentForEdit/listDocumentsOverview both read through docs_document_members).
    expect(store.docs_document_members).toEqual([
      expect.objectContaining({ documentId: 'new-src-doc-1', userId: 'u2', role: 'owner' }),
    ]);
    expect(store.docs_drives).toEqual([]);
    expect(store.docs_user_prefs).toEqual([
      expect.objectContaining({ userId: 'u2', tenantId: 't1', defaultView: 'markdown' }),
    ]);
  });

  it("skips a document whose folder isn't among the exporting user's own folders (they only had editor access to it, not ownership) rather than fabricating one", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.docs',
      schemaVersion: 4,
      data: {
        drive: null,
        defaultView: null,
        folders: [],
        documents: [
          { id: 'src-doc-1', folderId: 'someone-elses-folder', title: 'Orphan', slug: 'orphan', content: 'x', storage: 'db', gitPath: null, syncStatus: null, lastSyncedAt: null, createdAt: 1, updatedAt: 1 },
        ],
        documentMembers: [],
      },
    };

    await capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId: (id) => `new-${id}` });

    expect(store.docs_documents).toEqual([]);
    expect(store.docs_document_members).toEqual([]);
  });

  it('rejects an export section with a stale schema version', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.docs',
      schemaVersion: 3,
      data: { drive: null, defaultView: null, folders: [], documents: [], documentMembers: [] },
    };

    await expect(
      capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId: (id) => `new-${id}` }),
    ).rejects.toThrow(/unrecognized shape/);
  });
});

describe('portability delete', () => {
  it("transfers ownership of a document with other members instead of deleting it, removes the user's own share of a document they don't own, cascade-deletes a document filed under a folder that has no successor (even one already transferred at the document level), transfers a folder with a successor member, disconnects the drive connection, and cleans up preferences", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.docs_drives = [{ userId: 'u1', tenantId: 't1', connectionId: 'conn-1', branch: 'main', basePath: 'docs', createdAt: 1 }];
    store.docs_folders = [
      { id: 'folder-1', tenantId: 't1', ownerId: 'u1', name: 'Mine, shared', slug: 'mine-shared', createdAt: 1 },
      { id: 'folder-2', tenantId: 't1', ownerId: 'u1', name: 'Mine, sole', slug: 'mine-sole', createdAt: 1 },
      { id: 'folder-3', tenantId: 't1', ownerId: 'other', name: 'Not mine', slug: 'not-mine', createdAt: 1 },
    ];
    store.docs_documents = [
      { id: 'doc-1', tenantId: 't1', ownerId: 'u1', folderId: 'folder-1', title: 'In a surviving folder', slug: 'doc-1', content: 'a', storage: 'db', createdAt: 1, updatedAt: 1 },
      { id: 'doc-2', tenantId: 't1', ownerId: 'u1', folderId: 'folder-2', title: 'In a hard-deleted folder', slug: 'doc-2', content: 'b', storage: 'db', createdAt: 1, updatedAt: 1 },
      { id: 'doc-3', tenantId: 't1', ownerId: 'other', folderId: 'folder-3', title: 'Not mine', slug: 'doc-3', content: 'c', storage: 'db', createdAt: 1, updatedAt: 1 },
    ];
    store.docs_user_prefs = [
      { userId: 'u1', tenantId: 't1', defaultView: 'wysiwyg', createdAt: 1, updatedAt: 1 },
      { userId: 'other', tenantId: 't1', defaultView: 'markdown', createdAt: 1, updatedAt: 1 },
    ];
    store.docs_document_members = [
      // doc-1: u1 owner, 'other' viewer -> transfers to 'other' at the document level.
      { documentId: 'doc-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { documentId: 'doc-1', userId: 'other', tenantId: 't1', role: 'viewer', invitedBy: 'u1', joinedAt: 2 },
      // doc-2: same shape as doc-1 (u1 owner, 'other' viewer) -> also transfers at the
      // document level, but folder-2 (its folder) has no successor and gets
      // hard-deleted, cascading doc-2 away regardless of the document-level transfer.
      { documentId: 'doc-2', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { documentId: 'doc-2', userId: 'other', tenantId: 't1', role: 'viewer', invitedBy: 'u1', joinedAt: 2 },
      // doc-3: u1 only has a share on someone else's document.
      { documentId: 'doc-3', userId: 'u1', tenantId: 't1', role: 'viewer', invitedBy: 'other', joinedAt: 1 },
      { documentId: 'doc-3', userId: 'other', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];
    store.docs_folder_members = [
      // folder-1: u1 owner, 'other' viewer -> transfers to 'other' (survives).
      { folderId: 'folder-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { folderId: 'folder-1', userId: 'other', tenantId: 't1', role: 'viewer', invitedBy: 'u1', joinedAt: 2 },
      // folder-2: u1 is the sole member -> no successor, hard-deleted.
      { folderId: 'folder-2', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      // folder-3: u1 has no role here at all (not shared the folder itself, just doc-3 individually).
      { folderId: 'folder-3', userId: 'other', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });
    expect(result).toBeDefined();

    // folder-1 survives (transferred to 'other'); folder-2 is hard-deleted (no successor); folder-3 untouched.
    expect(store.docs_folders.map((f) => f.id).sort()).toEqual(['folder-1', 'folder-3']);
    expect(store.docs_folders.find((f) => f.id === 'folder-1')).toMatchObject({ ownerId: 'other' });
    expect(store.docs_folder_members).toEqual([
      expect.objectContaining({ folderId: 'folder-1', userId: 'other', role: 'owner' }),
      expect.objectContaining({ folderId: 'folder-3', userId: 'other', role: 'owner' }),
    ]);

    // doc-1 survives (its folder survived); doc-2 is cascade-deleted with
    // folder-2 despite having its own document-level successor; doc-3
    // (not owned by u1) is untouched.
    expect(store.docs_documents.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-3']);
    expect(store.docs_documents.find((d) => d.id === 'doc-1')).toMatchObject({
      ownerId: 'other',
      folderId: 'folder-1',
    });
    expect(store.docs_document_members).toEqual([
      expect.objectContaining({ documentId: 'doc-1', userId: 'other', role: 'owner' }),
      expect.objectContaining({ documentId: 'doc-3', userId: 'other', role: 'owner' }),
    ]);

    expect(store.docs_drives).toEqual([]);
    expect(disconnectMock).toHaveBeenCalledWith('conn-1');
    // The user's own preference row is removed; another user's is left intact.
    expect(store.docs_user_prefs).toEqual([expect.objectContaining({ userId: 'other' })]);
    expect(result?.deleted).toBeGreaterThan(0);
  });
});
