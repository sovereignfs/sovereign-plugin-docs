import type { ReactNode } from 'react';
import { ThreeColumnLayout } from '@sovereignfs/ui';
import { DocsSidebar } from '../_components/DocsSidebar';
import { getDrive } from '../_lib/actions';
import { listDocumentsOverview } from '../_lib/documents';
import styles from './layout.module.css';

/**
 * Route-group layout for every view that keeps the persistent sidebar:
 * Folders (`/docs`), Folder view (`/docs/f/[id]`), Inbox (`/docs/inbox`),
 * and Settings (`/docs/settings`). The Document editor (`/docs/d/[id]`)
 * lives outside this group — same split as the Kanban plugin's own
 * `(home)/layout.tsx`, just with Folder view and Settings kept *inside*
 * the sidebar scope here (Docs' folder-detail view is the sidebar-
 * persisting drill-down, unlike Kanban's Board View).
 *
 * A shared ancestor layout isn't re-fetched by the Next.js App Router on
 * client-side navigation between sibling routes under it, so the sidebar
 * stays mounted with no flash moving between any of these four views.
 *
 * `sidebarWidth={280}` matches the Kanban plugin's own hand-rolled sidebar
 * (`kanban.module.css`'s `.sidebar { flex: 0 0 280px }`) — already
 * ThreeColumnLayout's own default, passed explicitly here for clarity.
 */
export default async function DocsHomeLayout({ children }: { children: ReactNode }) {
  const drive = await getDrive();
  const overview = await listDocumentsOverview(drive);

  return (
    <div className={styles.homeFrame}>
      {/* No wrapper div around `children` — ThreeColumnLayout's own `.main`
          slot already provides `flex: 1; overflow-y: auto`; adding another
          `overflow-y: auto` div inside it would just double up the scroll
          container for no benefit. */}
      <ThreeColumnLayout sidebarWidth={280}>
        <DocsSidebar folders={overview.folders} />
        {children}
      </ThreeColumnLayout>
    </div>
  );
}
