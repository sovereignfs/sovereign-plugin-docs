'use client';

import { useMemo, useState } from 'react';
import { EmptyState, Input } from '@sovereignfs/ui';
import type { DocumentsOverview } from '../_lib/documents';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { CreateProjectDialog } from './CreateProjectDialog';
import { Tile } from './Tile';
import styles from './DocumentsList.module.css';

/**
 * Drive-style home (D-09): project + document tiles, search, and the quota
 * indicator. An **owned** document only shows here when it's root-level
 * (`projectId === null`) — one filed under a project appears on that
 * project's own page (`/docs/projects/[projectId]`) instead, same
 * top-level-only convention as Google Drive's "My Drive" root. A
 * **shared-with-me** document (D-13) always shows here regardless of its
 * `projectId`, since the recipient has no access to the owner's project
 * entity to browse into otherwise — this is its only findable location.
 */
export function DocumentsList({ overview }: { overview: DocumentsOverview }) {
  const { projects, documents, dbCount, limit, driveConnected } = overview;
  const [query, setQuery] = useState('');

  const visibleDocuments = useMemo(
    () => documents.filter((doc) => (doc.owned ? doc.projectId === null : true)),
    [documents],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProjects = normalizedQuery
    ? projects.filter((project) => project.name.toLowerCase().includes(normalizedQuery))
    : projects;
  const filteredDocuments = normalizedQuery
    ? visibleDocuments.filter((doc) => doc.title.toLowerCase().includes(normalizedQuery))
    : visibleDocuments;

  const isEmptyWorkspace = projects.length === 0 && visibleDocuments.length === 0;
  const hasNoResults = !isEmptyWorkspace && filteredProjects.length === 0 && filteredDocuments.length === 0;

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <p className={styles.quota}>
          {driveConnected
            ? 'Unlimited documents (Git connected)'
            : `${dbCount} of ${limit} documents`}
        </p>
        <div className={styles.actions}>
          <CreateProjectDialog />
          <CreateDocumentDialog projects={projects} driveConnected={driveConnected} />
        </div>
      </div>

      {!isEmptyWorkspace && (
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documents and projects…"
          aria-label="Search documents and projects"
          className={styles.search}
        />
      )}

      {isEmptyWorkspace ? (
        <EmptyState
          heading="No documents yet"
          description="Create your first document to get started."
          action={<CreateDocumentDialog projects={projects} driveConnected={driveConnected} />}
        />
      ) : hasNoResults ? (
        <EmptyState heading="No matches" description={`Nothing found for "${query}".`} />
      ) : (
        <div className={styles.lists}>
          {filteredProjects.length > 0 && (
            <div>
              <h2 className={styles.heading}>Projects</h2>
              <ul className={styles.grid}>
                {filteredProjects.map((project) => (
                  <li key={project.id}>
                    <Tile href={`/docs/projects/${project.id}`} label={project.name} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {filteredDocuments.length > 0 && (
            <div>
              <h2 className={styles.heading}>Documents</h2>
              <ul className={styles.grid}>
                {filteredDocuments.map((doc) => (
                  <li key={doc.id}>
                    <Tile href={`/docs/${doc.id}`} label={doc.title} badge={documentBadge(doc)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function documentBadge(doc: DocumentsOverview['documents'][number]): string | undefined {
  const parts: string[] = [];
  if (doc.storage === 'git') parts.push('Git');
  if (!doc.owned) parts.push('Shared');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
