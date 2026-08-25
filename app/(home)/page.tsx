import { HomeFoldersList } from '../_components/HomeFoldersList';
import { getDrive } from '../_lib/actions';
import { listDocumentsOverview } from '../_lib/documents';
import styles from './page.module.css';

export default async function SovereignDocsIndexPage() {
  const drive = await getDrive();
  const overview = await listDocumentsOverview(drive);

  return (
    <div className={styles.page}>
      <HomeFoldersList overview={overview} />
    </div>
  );
}
