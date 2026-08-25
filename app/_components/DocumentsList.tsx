'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CardTile, CardTileGrid, EmptyState, Icon, Input } from '@sovereignfs/ui';
import type { DocumentsOverview } from '../_lib/documents';
import { CreateFolderDialog } from './CreateFolderDialog';
import styles from './DocumentsList.module.css';

/**
 * Drive-style home (D-09), grouped like the Kanban plugin's own home page:
 * "My folders" / "Shared with me" (split on `docs_folder_members` role —
 * folder sharing, unlike Kanban's board-membership-separate model, also
 * grants access to every document already filed under the folder, see
 * `documents.ts`'s `resolveDocumentRole`), then a flat "Shared documents"
 * section.
 *
 * Every document now belongs to a folder — there's no root level, so
 * document creation only ever happens from inside a folder
 * (`FolderDocumentsGrid`/the folder detail page), never here. "Shared
 * documents" only ever holds documents individually shared with this user
 * (D-13) — an owned document is always reachable by opening its folder
 * instead, never shown flat.
 *
 * Search collapses back to a flat "Folders"/"Documents" match list (no
 * grouping) — grouping exists for browsing, not filtering.
 */
export function DocumentsList({ overview }: { overview: DocumentsOverview }) {
  const { folders, documents, dbCount, limit, driveConnected } = overview;
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const filteredFolders = isSearching
    ? folders.filter((folder) => folder.name.toLowerCase().includes(normalizedQuery))
    : folders;
  const filteredDocuments = isSearching
    ? documents.filter((doc) => doc.title.toLowerCase().includes(normalizedQuery))
    : documents;

  const isEmptyWorkspace = folders.length === 0 && documents.length === 0;
  const hasNoResults =
    isSearching && filteredFolders.length === 0 && filteredDocuments.length === 0;

  const myFolders = filteredFolders.filter((folder) => folder.role === 'owner');
  const sharedFolders = filteredFolders.filter((folder) => folder.role !== 'owner');

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <p className={styles.quota}>
          {driveConnected
            ? 'Unlimited documents (Git connected)'
            : `${dbCount} of ${limit} documents`}
        </p>
        <CreateFolderDialog />
      </div>

      {!isEmptyWorkspace && (
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documents and folders…"
          aria-label="Search documents and folders"
          className={styles.search}
        />
      )}

      {isEmptyWorkspace ? (
        <EmptyState
          heading="No folders yet"
          description="Create your first folder to get started."
          action={<CreateFolderDialog />}
        />
      ) : hasNoResults ? (
        <EmptyState heading="No matches" description={`Nothing found for "${query}".`} />
      ) : isSearching ? (
        <div className={styles.lists}>
          {filteredFolders.length > 0 && (
            <div>
              <h2 className={styles.heading}>Folders</h2>
              <CardTileGrid>
                {filteredFolders.map((folder) => (
                  <FolderTile key={folder.id} folder={folder} />
                ))}
              </CardTileGrid>
            </div>
          )}
          {filteredDocuments.length > 0 && (
            <div>
              <h2 className={styles.heading}>Documents</h2>
              <CardTileGrid>
                {filteredDocuments.map((doc) => (
                  <DocumentTile key={doc.id} doc={doc} />
                ))}
              </CardTileGrid>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.lists}>
          <div>
            <h2 className={styles.heading}>My folders</h2>
            {myFolders.length === 0 ? (
              <p className={styles.groupEmpty}>You haven&apos;t created a folder yet.</p>
            ) : (
              <CardTileGrid>
                {myFolders.map((folder) => (
                  <FolderTile key={folder.id} folder={folder} />
                ))}
              </CardTileGrid>
            )}
          </div>

          <div>
            <h2 className={styles.heading}>Shared with me</h2>
            {sharedFolders.length === 0 ? (
              <p className={styles.groupEmpty}>Nothing shared with you yet.</p>
            ) : (
              <CardTileGrid>
                {sharedFolders.map((folder) => (
                  <FolderTile key={folder.id} folder={folder} shared />
                ))}
              </CardTileGrid>
            )}
          </div>

          {documents.length > 0 && (
            <div>
              <h2 className={styles.heading}>Shared documents</h2>
              <CardTileGrid>
                {filteredDocuments.map((doc) => (
                  <DocumentTile key={doc.id} doc={doc} />
                ))}
              </CardTileGrid>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FolderTile({
  folder,
  shared = false,
}: {
  folder: DocumentsOverview['folders'][number];
  shared?: boolean;
}) {
  return (
    <Link href={`/docs/f/${folder.id}`}>
      <CardTile banner={<Icon name="folder" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel}>{folder.name}</span>
        {shared && <span className={styles.tileBadge}>Shared</span>}
      </CardTile>
    </Link>
  );
}

function DocumentTile({ doc }: { doc: DocumentsOverview['documents'][number] }) {
  const badge = documentBadge(doc);
  return (
    <Link href={`/docs/d/${doc.id}`}>
      <CardTile banner={<Icon name="file" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel}>{doc.title}</span>
        {badge && <span className={styles.tileBadge}>{badge}</span>}
      </CardTile>
    </Link>
  );
}

function documentBadge(doc: DocumentsOverview['documents'][number]): string | undefined {
  const parts: string[] = [];
  if (doc.storage === 'git') parts.push('Git');
  if (!doc.owned) parts.push('Shared');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
