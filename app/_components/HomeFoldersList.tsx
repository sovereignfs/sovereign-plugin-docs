'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CardTile, CardTileGrid, EmptyState, Icon, Input, PageHeader } from '@sovereignfs/ui';
import type { DocumentsOverview } from '../_lib/documents';
import { CreateFolderDialog } from './CreateFolderDialog';
import styles from './HomeFoldersList.module.css';

/**
 * Drive-style home (D-09), grouped like the Kanban plugin's own home page:
 * "My folders" / "Shared with me", split on `docs_folder_members` role.
 * Folder-only now — individually-shared documents (D-13) moved to Inbox
 * (`app/(home)/inbox/page.tsx`), since the sidebar's own "Folders" nav item
 * and this page's main content both only ever show folders, mirroring the
 * plugin's own folder-centric browsing model (a document is always one
 * level down, inside a folder).
 *
 * Renders its own `PageHeader` (rather than `page.tsx` rendering one above
 * it) so the search input — which needs the `query` state this component
 * already owns — can sit as the header's `action`, on the header's own row
 * instead of a separate full-width row below it. The quota line moved out
 * entirely, to `DocsSidebar`'s bottom section — ambient and always visible
 * there, rather than only on this one page.
 *
 * No persistent "New folder" toolbar button — matches Kanban's `HomeView`,
 * which only offers a creation entry point in the empty state once
 * `DocsSidebar`'s own "+" (next to "My Folders") exists as the persistent
 * entry point.
 *
 * Search collapses back to a flat "Folders" match list (no grouping) —
 * grouping exists for browsing, not filtering.
 */
export function HomeFoldersList({ overview }: { overview: DocumentsOverview }) {
  const { folders } = overview;
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const filteredFolders = isSearching
    ? folders.filter((folder) => folder.name.toLowerCase().includes(normalizedQuery))
    : folders;

  const isEmptyWorkspace = folders.length === 0;
  const hasNoResults = isSearching && filteredFolders.length === 0;

  const myFolders = filteredFolders.filter((folder) => folder.role === 'owner');
  const sharedFolders = filteredFolders.filter((folder) => folder.role !== 'owner');

  return (
    <div className={styles.section}>
      <PageHeader
        title="Docs"
        description="A local-first document workspace."
        action={
          !isEmptyWorkspace ? (
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search folders…"
              aria-label="Search folders"
              className={styles.search}
            />
          ) : undefined
        }
      />

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
          <CardTileGrid dense minTileWidth={160}>
            {filteredFolders.map((folder) => (
              <FolderTile key={folder.id} folder={folder} shared={folder.role !== 'owner'} />
            ))}
          </CardTileGrid>
        </div>
      ) : (
        <div className={styles.lists}>
          <div>
            <h2 className={styles.heading}>My folders</h2>
            {myFolders.length === 0 ? (
              <p className={styles.groupEmpty}>You haven&apos;t created a folder yet.</p>
            ) : (
              <CardTileGrid dense minTileWidth={160}>
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
              <CardTileGrid dense minTileWidth={160}>
                {sharedFolders.map((folder) => (
                  <FolderTile key={folder.id} folder={folder} shared />
                ))}
              </CardTileGrid>
            )}
          </div>
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
    <Link href={`/docs/f/${folder.id}`} className={styles.tileLink}>
      <CardTile variant="icon" banner={<Icon name="folder-closed" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel} title={folder.name}>
          {folder.name}
        </span>
        {shared && <span className={styles.tileBadge}>Shared</span>}
      </CardTile>
    </Link>
  );
}
