import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '@sovereignfs/ui';
import { CreateDocumentDialog } from '../../_components/CreateDocumentDialog';
import { ProjectDocumentsGrid } from '../../_components/ProjectDocumentsGrid';
import { ProjectShareButton } from '../../_components/ProjectShareButton';
import { getDrive } from '../../_lib/actions';
import { getProjectOverview } from '../../_lib/documents';
import {
  inviteProjectMember,
  listProjectMembers,
  removeProjectMember,
  searchProjectDirectoryUsers,
} from '../../_lib/project-sharing';
import styles from './page.module.css';

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const overview = await getProjectOverview(projectId);
  if (!overview) notFound();

  const drive = await getDrive();
  const driveConnected = drive?.status === 'connected';
  const { project, documents, canEdit } = overview;

  return (
    <div className={styles.page}>
      <Link href="/docs" className={styles.backLink}>
        ← Docs
      </Link>

      <PageHeader
        title={project.name}
        action={
          project.role === 'owner' ? (
            <ProjectShareButton
              listMembersAction={listProjectMembers.bind(null, project.id)}
              searchUsersAction={searchProjectDirectoryUsers.bind(null, project.id)}
              inviteAction={inviteProjectMember.bind(null, project.id)}
              removeAction={removeProjectMember.bind(null, project.id)}
            />
          ) : undefined
        }
      />

      {documents.length === 0 ? (
        <EmptyState
          heading="No documents in this project yet"
          description={
            canEdit
              ? 'Create the first one to get started.'
              : 'The project owner hasn’t added any documents yet.'
          }
          action={
            canEdit ? (
              <CreateDocumentDialog
                projects={[]}
                driveConnected={driveConnected}
                fixedProjectId={project.id}
              />
            ) : undefined
          }
        />
      ) : (
        <ProjectDocumentsGrid
          documents={documents}
          fixedProjectId={project.id}
          driveConnected={driveConnected}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
