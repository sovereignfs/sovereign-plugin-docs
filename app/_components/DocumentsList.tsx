'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CardTile, CardTileGrid, EmptyState, Icon, Input, NewCardTile } from '@sovereignfs/ui';
import type { DocumentsOverview } from '../_lib/documents';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { CreateProjectDialog } from './CreateProjectDialog';
import styles from './DocumentsList.module.css';

/**
 * Drive-style home (D-09), grouped like the Kanban plugin's own home page:
 * "My projects" / "Shared with me" (split on `docs_project_members` role —
 * project sharing, unlike Kanban's board-membership-separate model, also
 * grants access to every document already filed under the project, see
 * `documents.ts`'s `resolveDocumentRole`), then a flat "Documents" section.
 *
 * An **owned** document only shows in "Documents" when it's root-level
 * (`projectId === null`) — one filed under a project appears on that
 * project's own page (`/docs/projects/[projectId]`) instead, same
 * top-level-only convention as Google Drive's "My Drive" root. A
 * **shared-with-me** document (D-13) always shows here regardless of its
 * `projectId`, since the recipient has no access to the owner's project
 * entity to browse into otherwise — this is its only findable location.
 * A document reachable purely via project role (not an individual share)
 * stays out of this flat list too — it's browsable by opening the project.
 *
 * Search collapses back to a flat "Projects"/"Documents" match list (no
 * grouping) — grouping exists for browsing, not filtering.
 */
export function DocumentsList({ overview }: { overview: DocumentsOverview }) {
  const { projects, documents, dbCount, limit, driveConnected } = overview;
  const [query, setQuery] = useState('');

  const visibleDocuments = useMemo(
    () => documents.filter((doc) => (doc.owned ? doc.projectId === null : true)),
    [documents],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const filteredProjects = isSearching
    ? projects.filter((project) => project.name.toLowerCase().includes(normalizedQuery))
    : projects;
  const filteredDocuments = isSearching
    ? visibleDocuments.filter((doc) => doc.title.toLowerCase().includes(normalizedQuery))
    : visibleDocuments;

  const isEmptyWorkspace = projects.length === 0 && visibleDocuments.length === 0;
  const hasNoResults =
    isSearching && filteredProjects.length === 0 && filteredDocuments.length === 0;

  const myProjects = filteredProjects.filter((project) => project.role === 'owner');
  const sharedProjects = filteredProjects.filter((project) => project.role !== 'owner');

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <p className={styles.quota}>
          {driveConnected
            ? 'Unlimited documents (Git connected)'
            : `${dbCount} of ${limit} documents`}
        </p>
        <CreateProjectDialog />
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
      ) : isSearching ? (
        <div className={styles.lists}>
          {filteredProjects.length > 0 && (
            <div>
              <h2 className={styles.heading}>Projects</h2>
              <CardTileGrid>
                {filteredProjects.map((project) => (
                  <ProjectTile key={project.id} project={project} />
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
            <h2 className={styles.heading}>My projects</h2>
            {myProjects.length === 0 ? (
              <p className={styles.groupEmpty}>You haven&apos;t created a project yet.</p>
            ) : (
              <CardTileGrid>
                {myProjects.map((project) => (
                  <ProjectTile key={project.id} project={project} />
                ))}
              </CardTileGrid>
            )}
          </div>

          <div>
            <h2 className={styles.heading}>Shared with me</h2>
            {sharedProjects.length === 0 ? (
              <p className={styles.groupEmpty}>Nothing shared with you yet.</p>
            ) : (
              <CardTileGrid>
                {sharedProjects.map((project) => (
                  <ProjectTile key={project.id} project={project} shared />
                ))}
              </CardTileGrid>
            )}
          </div>

          <div>
            <h2 className={styles.heading}>Documents</h2>
            <CardTileGrid>
              {filteredDocuments.map((doc) => (
                <DocumentTile key={doc.id} doc={doc} />
              ))}
              <CreateDocumentDialog
                projects={projects}
                driveConnected={driveConnected}
                renderTrigger={({ onClick }) => (
                  <NewCardTile label="New document" onClick={onClick} />
                )}
              />
            </CardTileGrid>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectTile({
  project,
  shared = false,
}: {
  project: DocumentsOverview['projects'][number];
  shared?: boolean;
}) {
  return (
    <Link href={`/docs/projects/${project.id}`}>
      <CardTile banner={<Icon name="folder" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel}>{project.name}</span>
        {shared && <span className={styles.tileBadge}>Shared</span>}
      </CardTile>
    </Link>
  );
}

function DocumentTile({ doc }: { doc: DocumentsOverview['documents'][number] }) {
  const badge = documentBadge(doc);
  return (
    <Link href={`/docs/${doc.id}`}>
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
