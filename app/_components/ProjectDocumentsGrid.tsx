'use client';

import Link from 'next/link';
import { CardTile, CardTileGrid, Icon, NewCardTile } from '@sovereignfs/ui';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import styles from './ProjectDocumentsGrid.module.css';

interface ProjectDocumentsGridProps {
  documents: { id: string; title: string; storage: 'db' | 'git' }[];
  fixedProjectId: string;
  driveConnected: boolean;
  canEdit: boolean;
}

/**
 * The project detail page's document grid, split into its own client
 * component so `CreateDocumentDialog`'s `renderTrigger` closure is created
 * and consumed entirely client-side — passing a plain function as a prop
 * from the page's Server Component straight to a Client Component isn't
 * allowed ("Functions cannot be passed directly to Client Components").
 */
export function ProjectDocumentsGrid({
  documents,
  fixedProjectId,
  driveConnected,
  canEdit,
}: ProjectDocumentsGridProps) {
  return (
    <CardTileGrid>
      {documents.map((doc) => (
        <Link key={doc.id} href={`/docs/${doc.id}`}>
          <CardTile banner={<Icon name="file" size="lg" aria-hidden={true} />}>
            <span className={styles.tileLabel}>{doc.title}</span>
            {doc.storage === 'git' && <span className={styles.tileBadge}>Git</span>}
          </CardTile>
        </Link>
      ))}
      {canEdit && (
        <CreateDocumentDialog
          projects={[]}
          driveConnected={driveConnected}
          fixedProjectId={fixedProjectId}
          renderTrigger={({ onClick }) => <NewCardTile label="New document" onClick={onClick} />}
        />
      )}
    </CardTileGrid>
  );
}
