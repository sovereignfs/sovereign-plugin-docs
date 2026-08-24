'use client';

import Link from 'next/link';
import styles from '../docs.module.css';
import { AppsMenu } from './AppsMenu';
import { DocsAccountMenu, type DocsAccountMenuUser } from './DocsAccountMenu';

export type DocsHeaderUser = DocsAccountMenuUser;

/**
 * Web-only top bar (hidden below the mobile breakpoint — mobile gets its own
 * equivalent, `DocsMobileHeader`). Renders on every plugin page via the root
 * layout.
 *
 * `shell: minimal` gives the plugin zero platform chrome, so this replaces
 * what the platform's own header would have provided: a way back to
 * Launcher (left) and the current user's identity (right). Mirrors Kanban's
 * own `KanbanHeader` (`plugins/sovereign-plugin-kanban.local`) 1:1 — same
 * compact 48px bar, same left/right composition, same DS-primitive rebuild
 * of the account menu — since this plugin now makes the identical `shell:
 * default` → `shell: minimal` migration Kanban already did.
 *
 * The instance-initial badge (left, next to the Docs wordmark) is the same
 * accent-filled tile the platform's own sidebar renders and still just links
 * to `/launcher`.
 *
 * The Apps trigger (`AppsMenu`) is a separate control, next to the avatar:
 * the actual Launcher plugin's own icon, opening a floating apps switcher
 * rather than navigating. `shell: minimal` gets no sidebar/Apps drawer at
 * all, so this is this plugin's only way to jump directly to another app
 * without a full round trip through `/launcher` first.
 */
export function DocsHeader({
  user,
  instanceName,
  isAdmin,
}: {
  user: DocsHeaderUser;
  instanceName: string;
  isAdmin: boolean;
}) {
  const brandInitial = instanceName.charAt(0).toUpperCase() || 'S';

  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Link
          href="/launcher"
          className={styles.headerBrandBadge}
          aria-label={`${instanceName} Launcher`}
        >
          {brandInitial}
        </Link>
        <Link href="/docs" className={styles.headerBrand}>
          <img
            src="/plugin-icons/fs.sovereign.docs.svg"
            alt=""
            className={styles.headerBrandIcon}
          />
          <span className={styles.headerBrandName}>Docs</span>
        </Link>
      </div>

      <div className={styles.headerRight}>
        <AppsMenu isAdmin={isAdmin} />
        <DocsAccountMenu user={user} avatarSize="md" />
      </div>
    </header>
  );
}
