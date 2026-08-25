import Link from 'next/link';
import { PageHeader } from '@sovereignfs/ui';
import { ConnectDriveForm } from '../../_components/ConnectDriveForm';
import { DriveStatusCard } from '../../_components/DriveStatusCard';
import { getDrive } from '../../_lib/actions';
import styles from './page.module.css';

/**
 * Configure-once concerns (the Git connection) live here, off the daily
 * document surface — SPEC.md's storage tiers are opt-in, so connecting a
 * drive is a settings action, not a first-run gate (see the local-first
 * pivot in SPEC.md's changelog).
 */
export default async function SettingsPage() {
  const drive = await getDrive();

  return (
    <div className={styles.page}>
      <Link href="/docs" className={styles.backLink}>
        ← Docs
      </Link>
      <PageHeader title="Settings" description="Manage your Sovereign Docs workspace." />

      {drive ? (
        <>
          <DriveStatusCard drive={drive} />
          {drive.status !== 'connected' ? <ConnectDriveForm reconnect /> : null}
        </>
      ) : (
        <ConnectDriveForm />
      )}
    </div>
  );
}
