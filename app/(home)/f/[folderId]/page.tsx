import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '@sovereignfs/ui';
import { CreateDocumentDialog } from '../../../_components/CreateDocumentDialog';
import { FolderDocumentsGrid } from '../../../_components/FolderDocumentsGrid';
import { FolderShareButton } from '../../../_components/FolderShareButton';
import { getDrive } from '../../../_lib/actions';
import { getFolderOverview } from '../../../_lib/documents';
import {
  inviteFolderMember,
  listFolderMembers,
  removeFolderMember,
  searchFolderDirectoryUsers,
} from '../../../_lib/folder-sharing';
import styles from './page.module.css';

interface FolderPageProps {
  params: Promise<{ folderId: string }>;
}

export default async function FolderPage({ params }: FolderPageProps) {
  const { folderId } = await params;
  const overview = await getFolderOverview(folderId);
  if (!overview) notFound();

  const drive = await getDrive();
  const driveConnected = drive?.status === 'connected';
  const { folder, documents, canEdit } = overview;

  return (
    <div className={styles.page}>
      <Link href="/docs" className={styles.backLink}>
        ← Folders
      </Link>

      <PageHeader
        title={folder.name}
        icon="folder-open"
        action={
          folder.role === 'owner' ? (
            <FolderShareButton
              listMembersAction={listFolderMembers.bind(null, folder.id)}
              searchUsersAction={searchFolderDirectoryUsers.bind(null, folder.id)}
              inviteAction={inviteFolderMember.bind(null, folder.id)}
              removeAction={removeFolderMember.bind(null, folder.id)}
            />
          ) : undefined
        }
      />

      {documents.length === 0 ? (
        <EmptyState
          heading="No documents in this folder yet"
          description={
            canEdit
              ? 'Create the first one to get started.'
              : 'The folder owner hasn’t added any documents yet.'
          }
          action={
            canEdit ? (
              <CreateDocumentDialog folderId={folder.id} driveConnected={driveConnected} />
            ) : undefined
          }
        />
      ) : (
        <FolderDocumentsGrid
          documents={documents}
          folderId={folder.id}
          driveConnected={driveConnected}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
