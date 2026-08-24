import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import { ToastProvider } from '@sovereignfs/ui';
import { DocsHeader } from './_components/DocsHeader';
import { DocsMobileHeader } from './_components/DocsMobileHeader';
import styles from './docs.module.css';
import { registerPortabilityHandlers } from './_lib/portability';

/**
 * Plugin shell for every page: a self-rendered top header (web) + mobile
 * header, matching the Kanban plugin's own `shell: minimal` migration
 * (`plugins/sovereign-plugin-kanban.local/app/layout.tsx`) — this plugin now
 * makes the same `shell: default` → `shell: minimal` move, so it owns its
 * whole viewport and provides its own chrome instead of relying on the
 * platform shell. Pages own their own padding (`page.module.css` et al.),
 * this layout adds no gutter of its own.
 *
 * `ToastProvider` is supplied here rather than assumed: under `shell:
 * default`, the platform's own `ClientShell` wraps every plugin page in one,
 * but `runtime/app/(minimal)/layout.tsx` (what `shell: minimal` composes
 * into) is deliberately chrome-free and provides none — a `minimal` plugin
 * owns its own tree, providers included. `DocsNotificationBell`'s toast
 * calls would throw without this, same failure Kanban hit live the moment it
 * first moved off `shell: default`.
 */
export default async function SovereignDocsLayout({ children }: { children: ReactNode }) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request. Best-effort: a registration failure must not block the
  // plugin's own UI (matches sovereign-tasks' layout.tsx).
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

  const [session, instanceName] = await Promise.all([
    sdk.auth.getSession(),
    // Best-effort: the header's brand badge is a cosmetic detail, not core
    // functionality, so a platform-config read failure (e.g. an
    // unseeded/legacy `instance_id` setting row on an older instance)
    // shouldn't take down the whole plugin — fall back to a sensible
    // default name instead of letting the layout throw.
    sdk.platform
      .getConfig()
      .then((config) => config.instanceName)
      .catch(() => 'Sovereign'),
  ]);

  // Platform-role admin check, same capability (`console:access`) and same
  // pattern the platform shell's own `AdminConsoleIcon` uses to gate its
  // Console link — gates the "Console" tile `AppsMenu` adds to its Apps
  // switcher below.
  const isAdmin = sdk.auth.hasCapability(session, 'console:access');

  const user = {
    name: session?.user.name ?? null,
    email: session?.user.email ?? '',
    image: session?.user.image ?? null,
  };

  return (
    <ToastProvider>
      {/* `id="sv-app-shell"` — the platform's own shell root id, never
          rendered for this plugin's own routes since `shell: minimal`
          composes under `(minimal)`, not `(platform)`, so reusing it here
          can't collide. `MobileHeader` already calls
          `usePublishShellChromeHeight` internally, looking up exactly this
          id — see `docs.module.css`'s own notes for why this matters. */}
      <div id="sv-app-shell" className={styles.shell}>
        <DocsHeader user={user} instanceName={instanceName} isAdmin={isAdmin} />
        <DocsMobileHeader user={user} instanceName={instanceName} />
        <div className={styles.body}>{children}</div>
      </div>
    </ToastProvider>
  );
}
