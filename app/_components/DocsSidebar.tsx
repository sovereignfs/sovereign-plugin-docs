'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, Typography } from '@sovereignfs/ui';
import type { DocumentsOverview } from '../_lib/documents';
import { CreateFolderDialog } from './CreateFolderDialog';
import styles from './DocsSidebar.module.css';

/** Persistent secondary nav, mirroring the Kanban plugin's own KanbanSidebar. */
const NAV = [
  { href: '/docs', label: 'Folders', icon: 'folders' as const },
  { href: '/docs/inbox', label: 'Inbox', icon: 'inbox' as const },
];

/**
 * Scoped to `app/(home)/layout.tsx` — every route under it (Folders, Folder
 * view, Inbox, Settings) keeps this sidebar mounted across navigation,
 * unlike Kanban's Board View, which is deliberately outside its own
 * sidebar-having route group. The Document editor (`/docs/d/[id]`) is the
 * Docs equivalent of Board View here — it lives outside `(home)` and gets
 * no sidebar.
 *
 * Below the Folders/Inbox nav, `folders` is split into "My Folders"
 * (`role === 'owner'`) and "Shared with me" (`role !== 'owner'`) — quick-
 * access rows, same precedent as `KanbanSidebar`'s "My projects"/"Shared
 * with me". This is a shortcut list, not the only way to browse folders —
 * the Home page's own main content shows the same split as a full tile
 * grid (mirrors Kanban's Home page duplicating its own sidebar's project
 * grouping in its main content).
 *
 * Settings is pinned to the bottom via `.bottomSection`'s `margin-top:
 * auto` — it's a configure-once screen, not a browsing section, so it's
 * kept visually distinct from the Folders/Inbox/quick-access nav above it.
 */
export function DocsSidebar({ folders }: { folders: DocumentsOverview['folders'] }) {
  const pathname = usePathname();
  const myFolders = folders.filter((folder) => folder.role === 'owner');
  const sharedFolders = folders.filter((folder) => folder.role !== 'owner');

  return (
    <nav className={styles.nav} aria-label="Docs sections">
      {NAV.map((item) => {
        const active =
          item.href === '/docs'
            ? pathname === '/docs' || pathname.startsWith('/docs/f/')
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[styles.link, active ? styles.linkActive : ''].filter(Boolean).join(' ')}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size="sm" aria-hidden={true} />
            {item.label}
          </Link>
        );
      })}

      <div className={styles.divider} />

      <div className={styles.group}>
        <div className={styles.groupHeader}>
          <Typography variant="label" className={styles.groupLabel}>
            My Folders
          </Typography>
          <CreateFolderDialog
            renderTrigger={({ onClick }) => (
              <button
                type="button"
                className={styles.groupAddButton}
                aria-label="New folder"
                onClick={onClick}
              >
                <Icon name="plus" size="sm" aria-hidden={true} />
              </button>
            )}
          />
        </div>
        {myFolders.map((folder) => (
          <Link key={folder.id} href={`/docs/f/${folder.id}`} className={styles.link}>
            {folder.name}
          </Link>
        ))}
      </div>

      <div className={styles.group}>
        <Typography variant="label" className={styles.groupLabel}>
          Shared with me
        </Typography>
        {sharedFolders.length === 0 ? (
          <Typography variant="caption" className={styles.groupEmpty}>
            Nothing shared with you yet
          </Typography>
        ) : (
          sharedFolders.map((folder) => (
            <Link key={folder.id} href={`/docs/f/${folder.id}`} className={styles.link}>
              {folder.name}
            </Link>
          ))
        )}
      </div>

      <div className={styles.bottomSection}>
        <div className={styles.divider} />
        <Link
          href="/docs/settings"
          className={[styles.link, pathname === '/docs/settings' ? styles.linkActive : '']
            .filter(Boolean)
            .join(' ')}
          aria-current={pathname === '/docs/settings' ? 'page' : undefined}
        >
          <Icon name="settings" size="sm" aria-hidden={true} />
          Settings
        </Link>
      </div>
    </nav>
  );
}
