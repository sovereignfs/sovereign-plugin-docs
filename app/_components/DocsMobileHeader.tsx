'use client';

import Link from 'next/link';
import { MobileHeader, useIsMobile } from '@sovereignfs/ui';
import styles from '../docs.module.css';
import { DocsAccountMenu, type DocsAccountMenuUser } from './DocsAccountMenu';
import { DocsNotificationBell } from './DocsNotificationBell';

/**
 * Mobile counterpart to `DocsHeader`, matching the real platform shell's own
 * mobile header shape 1:1 (`runtime/app/(platform)/layout.tsx`'s
 * `<MobileHeader logo=… bell=<NotificationBell/> avatarMenu=<AccountMenu/>>`)
 * — same `@sovereignfs/ui` component, same three-slot composition (brand,
 * bell, avatar menu), same underlying data (instance name, session user).
 * Mirrors Kanban's own `KanbanMobileHeader` (`plugins/sovereign-plugin-
 * kanban.local`) verbatim: `shell: minimal` means this plugin can't reach
 * the platform's real `MobileHeader` instance or its real
 * `NotificationBell`/`AccountMenu` (not part of `@sovereignfs/ui`'s
 * published surface), so both slots are filled with this plugin's own
 * equivalents instead of the literal platform components.
 *
 * `bell` is `DocsNotificationBell` — the real platform Notification Center
 * (same `/api/account/notifications` data, real unread count, real
 * mark-read/dismiss), not a Docs-scoped substitute.
 *
 * `title` is `instanceName`, not the plugin's own name — the real platform
 * mobile header always shows the instance brand regardless of which plugin
 * is active.
 *
 * `avatarMenu` is `DocsAccountMenu`, shared verbatim with the desktop header
 * — same account dropdown, not a second implementation. `avatarSize="md"`
 * matches the desktop header's own trigger size exactly.
 *
 * Gated by `useIsMobile()`, not CSS — avoids ever measuring/publishing
 * shell-chrome height from a hidden `MobileHeader` on desktop, and this
 * plugin's `shell: minimal` tree has no `#sv-app-shell` ancestor for that
 * publish to reach anyway.
 */
export function DocsMobileHeader({
  user,
  instanceName,
}: {
  user: DocsAccountMenuUser;
  instanceName: string;
}) {
  const isMobile = useIsMobile();
  const brandInitial = instanceName.charAt(0).toUpperCase() || 'S';

  if (!isMobile) return null;

  return (
    <MobileHeader
      className={styles.mobileHeader}
      logo={
        <Link
          href="/launcher"
          className={styles.mobileHeaderLogo}
          aria-label={`${instanceName} Launcher`}
        >
          {brandInitial}
        </Link>
      }
      title={instanceName}
      bell={<DocsNotificationBell />}
      avatarMenu={<DocsAccountMenu user={user} avatarSize="md" />}
    />
  );
}
