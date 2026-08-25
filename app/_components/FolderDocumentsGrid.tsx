'use client';

import Link from 'next/link';
import { CardTile, CardTileGrid, Icon, NewCardTile } from '@sovereignfs/ui';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import styles from './FolderDocumentsGrid.module.css';

interface FolderDocumentsGridProps {
  documents: { id: string; title: string; storage: 'db' | 'git' }[];
  folderId: string;
  driveConnected: boolean;
  canEdit: boolean;
}

/**
 * The folder detail page's document grid, split into its own client
 * component so `CreateDocumentDialog`'s `renderTrigger` closure is created
 * and consumed entirely client-side — passing a plain function as a prop
 * from the page's Server Component straight to a Client Component isn't
 * allowed ("Functions cannot be passed directly to Client Components").
 */
export function FolderDocumentsGrid({
  documents,
  folderId,
  driveConnected,
  canEdit,
}: FolderDocumentsGridProps) {
  return (
    <CardTileGrid dense minTileWidth={160}>
      {documents.map((doc) => (
        <Link key={doc.id} href={`/docs/d/${doc.id}`} className={styles.tileLink}>
          <CardTile variant="icon" banner={<Icon name="file-text" size="lg" aria-hidden={true} />}>
            <span className={styles.tileLabel} title={doc.title}>
              {doc.title}
            </span>
            {doc.storage === 'git' && <span className={styles.tileBadge}>Git</span>}
          </CardTile>
        </Link>
      ))}
      {canEdit && (
        <CreateDocumentDialog
          folderId={folderId}
          driveConnected={driveConnected}
          renderTrigger={({ onClick }) => (
            <NewCardTile variant="icon" label="New" onClick={onClick} />
          )}
        />
      )}
    </CardTileGrid>
  );
}
