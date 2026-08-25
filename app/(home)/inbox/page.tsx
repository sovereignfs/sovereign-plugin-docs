import Link from 'next/link';
import { CardTile, CardTileGrid, EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { getDrive } from '../../_lib/actions';
import { listDocumentsOverview, type DocumentsOverview } from '../../_lib/documents';
import styles from './page.module.css';

/**
 * "For now" scope, same framing as Kanban's own InboxPage docblock: this is
 * a "shared with you" digest — folders and documents shared with the
 * current user, not owned — distinct from Home's own "Shared with me"
 * folder section (which exists for ongoing browsing). Will grow into a
 * richer activity feed (mentions, task assignments, comments) once those
 * features exist; no such feed exists yet, so this stays a plain list.
 */
export default async function InboxPage() {
  const drive = await getDrive();
  const overview = await listDocumentsOverview(drive);

  const sharedFolders = overview.folders.filter((folder) => folder.role !== 'owner');
  const sharedDocuments = overview.documents;
  const isEmpty = sharedFolders.length === 0 && sharedDocuments.length === 0;

  return (
    <div className={styles.page}>
      <PageHeader title="Inbox" />

      {isEmpty ? (
        <EmptyState
          icon="inbox"
          heading="Nothing here yet"
          description="Folders and documents shared with you will show up here."
        />
      ) : (
        <div className={styles.lists}>
          {sharedFolders.length > 0 && (
            <div>
              <h2 className={styles.heading}>Folders shared with you</h2>
              <CardTileGrid dense minTileWidth={160}>
                {sharedFolders.map((folder) => (
                  <FolderTile key={folder.id} folder={folder} />
                ))}
              </CardTileGrid>
            </div>
          )}

          {sharedDocuments.length > 0 && (
            <div>
              <h2 className={styles.heading}>Documents shared with you</h2>
              <CardTileGrid dense minTileWidth={160}>
                {sharedDocuments.map((doc) => (
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

function FolderTile({ folder }: { folder: DocumentsOverview['folders'][number] }) {
  return (
    <Link href={`/docs/f/${folder.id}`} className={styles.tileLink}>
      <CardTile variant="icon" banner={<Icon name="folder-closed" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel} title={folder.name}>
          {folder.name}
        </span>
      </CardTile>
    </Link>
  );
}

function DocumentTile({ doc }: { doc: DocumentsOverview['documents'][number] }) {
  return (
    <Link href={`/docs/d/${doc.id}`} className={styles.tileLink}>
      <CardTile variant="icon" banner={<Icon name="file-text" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel} title={doc.title}>
          {doc.title}
        </span>
        {doc.storage === 'git' && <span className={styles.tileBadge}>Git</span>}
      </CardTile>
    </Link>
  );
}
