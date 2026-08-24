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
  docs_projects: Row[];
  docs_documents: Row[];
  docs_user_prefs: Row[];
  docs_document_members: Row[];
  docs_project_members: Row[];
}

let store: Store = {
  docs_drives: [],
  docs_projects: [],
  docs_documents: [],
  docs_user_prefs: [],
  docs_document_members: [],
  docs_project_members: [],
};

function resetStore() {
  store = {
    docs_drives: [],
    docs_projects: [],
    docs_documents: [],
    docs_user_prefs: [],
    docs_document_members: [],
    docs_project_members: [],
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
  it("exports only the user's own projects and documents (content inline), the user's view preference, and every member of a document they own, with a warning about the drive", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.docs_drives = [
      { userId: 'u1', tenantId: 't1', connectionId: 'conn-1', branch: 'main', basePath: 'docs', createdAt: 1 },
    ];
    store.docs_user_prefs = [{ userId: 'u1', tenantId: 't1', defaultView: 'wysiwyg', createdAt: 1, updatedAt: 1 }];
    store.docs_projects = [
      { id: 'proj-1', tenantId: 't1', ownerId: 'u1', name: 'Handbook', slug: 'handbook', createdAt: 1 },
      { id: 'proj-2', tenantId: 't1', ownerId: 'other', name: 'Not mine', slug: 'not-mine', createdAt: 1 },
    ];
    store.docs_documents = [
      { id: 'doc-1', tenantId: 't1', ownerId: 'u1', projectId: 'proj-1', title: 'Onboarding', slug: 'onboarding', content: 'Hello', storage: 'db', gitPath: null, baseSha: null, syncStatus: null, lastSyncedAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'doc-2', tenantId: 't1', ownerId: 'other', projectId: 'proj-2', title: 'Not mine', slug: 'not-mine', content: 'nope', storage: 'db', gitPath: null, baseSha: null, syncStatus: null, lastSyncedAt: null, createdAt: 1, updatedAt: 1 },
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
    expect((section as PluginExportSection).schemaVersion).toBe(3);

    const data = (section as PluginExportSection).data as {
      drive: { branch: string } | null;
      defaultView: string | null;
      projects: { id: string }[];
      documents: { id: string; content: string; storage: string }[];
      documentMembers: { documentId: string; userId: string; role: string }[];
    };
    expect(data.drive?.branch).toBe('main');
    expect(data.defaultView).toBe('wysiwyg');
    expect(data.projects.map((p) => p.id)).toEqual(['proj-1']);
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
  it('remaps a document to its project, scopes it to the importing user as a local doc with an owner membership row, without re-creating the drive or preference other users hold', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.docs',
      schemaVersion: 3,
      data: {
        drive: { branch: 'main', basePath: 'docs', createdAt: 1 },
        defaultView: 'markdown',
        projects: [{ id: 'src-proj-1', name: 'Handbook', slug: 'handbook', createdAt: 1 }],
        documents: [
          { id: 'src-doc-1', projectId: 'src-proj-1', title: 'Onboarding', slug: 'onboarding', content: 'Hello', storage: 'git', gitPath: 'docs/handbook/onboarding.md', syncStatus: 'synced', lastSyncedAt: 1, createdAt: 1, updatedAt: 1 },
        ],
        documentMembers: [{ documentId: 'src-doc-1', userId: 'u1', role: 'owner', invitedBy: null, joinedAt: 1 }],
      },
    };

    await capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId: (id) => `new-${id}` });

    expect(store.docs_projects).toEqual([
      expect.objectContaining({ id: 'new-src-proj-1', ownerId: 'u2', tenantId: 't1' }),
    ]);
    // An owner membership row is created — without it the project would be
    // unreachable (getProjectOverview/listDocumentsOverview both read
    // through docs_project_members, not ownerId directly).
    expect(store.docs_project_members).toEqual([
      expect.objectContaining({ projectId: 'new-src-proj-1', userId: 'u2', role: 'owner' }),
    ]);
    // A git-backed document is imported as local (its remote mirror is not re-created), content preserved.
    expect(store.docs_documents).toEqual([
      expect.objectContaining({
        id: 'new-src-doc-1',
        projectId: 'new-src-proj-1',
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

  it('rejects an export section with a stale schema version', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.docs',
      schemaVersion: 2,
      data: { drive: null, defaultView: null, projects: [], documents: [], documentMembers: [] },
    };

    await expect(
      capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId: (id) => `new-${id}` }),
    ).rejects.toThrow(/unrecognized shape/);
  });
});

describe('portability delete', () => {
  it("transfers ownership of a document with other members instead of deleting it, removes the user's own share of a document they don't own, disconnects the drive connection, and cleans up projects and preferences", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.docs_drives = [{ userId: 'u1', tenantId: 't1', connectionId: 'conn-1', branch: 'main', basePath: 'docs', createdAt: 1 }];
    store.docs_projects = [{ id: 'proj-1', tenantId: 't1', ownerId: 'u1', name: 'Mine', slug: 'mine', createdAt: 1 }];
    store.docs_documents = [
      { id: 'doc-1', tenantId: 't1', ownerId: 'u1', projectId: 'proj-1', title: 'Mine, shared', slug: 'mine', content: 'a', storage: 'db', createdAt: 1, updatedAt: 1 },
      { id: 'doc-2', tenantId: 't1', ownerId: 'u1', projectId: null, title: 'Mine, sole', slug: 'sole', content: 'c', storage: 'db', createdAt: 1, updatedAt: 1 },
      { id: 'doc-3', tenantId: 't1', ownerId: 'other', projectId: null, title: 'Not mine', slug: 'not-mine', content: 'b', storage: 'db', createdAt: 1, updatedAt: 1 },
    ];
    store.docs_user_prefs = [
      { userId: 'u1', tenantId: 't1', defaultView: 'wysiwyg', createdAt: 1, updatedAt: 1 },
      { userId: 'other', tenantId: 't1', defaultView: 'markdown', createdAt: 1, updatedAt: 1 },
    ];
    store.docs_document_members = [
      { documentId: 'doc-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { documentId: 'doc-1', userId: 'other', tenantId: 't1', role: 'viewer', invitedBy: 'u1', joinedAt: 2 },
      { documentId: 'doc-2', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { documentId: 'doc-3', userId: 'u1', tenantId: 't1', role: 'viewer', invitedBy: 'other', joinedAt: 1 },
      { documentId: 'doc-3', userId: 'other', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];
    // u1 is proj-1's sole project member (no successor) — deleting u1 hard-
    // deletes the project, same as before docs_project_members existed.
    store.docs_project_members = [
      { projectId: 'proj-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });
    expect(result).toBeDefined();

    expect(store.docs_projects).toEqual([]);
    expect(store.docs_project_members).toEqual([]);
    // doc-1 survives, transferred to its remaining member ('other') instead of being deleted.
    // doc-2 (sole owner, no other members) is hard-deleted. doc-3 (not owned by u1) is untouched.
    expect(store.docs_documents.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-3']);
    // doc-1's new owner ('other') has no docs_project_members role on proj-1,
    // and proj-1 has no successor and is hard-deleted — doc-1 is reparented
    // to root level rather than left pointing at a deleted project.
    expect(store.docs_documents.find((d) => d.id === 'doc-1')).toMatchObject({
      ownerId: 'other',
      projectId: null,
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
