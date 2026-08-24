'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog, FormField, Input } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/context';
import { createDocument } from '../_lib/documents';
import styles from './DialogForm.module.css';

interface CreateDocumentDialogProps {
  /** The document is always created directly in this folder — every document belongs to one. */
  folderId: string;
  driveConnected: boolean;
  /** Custom trigger instead of the default "New document" button — e.g. a dashed NewCardTile in a grid. */
  renderTrigger?: (props: { onClick: () => void }) => ReactNode;
}

export function CreateDocumentDialog({
  folderId,
  driveConnected,
  renderTrigger,
}: CreateDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createDocument,
    null,
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  // resolveDocumentStorage() (document-rules.ts) only mentions "git-backed"
  // in its error copy when a drive is already connected and the db quota
  // was the reason for the block — exactly when offering the retry makes sense.
  const offerGitBackedRetry = Boolean(
    state && !state.ok && driveConnected && state.error.includes('git-backed'),
  );

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: () => setOpen(true) })
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          New document
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="New document">
        <form action={formAction} className={styles.form}>
          {state && !state.ok && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {state.error}
            </p>
          )}
          <FormField label="Title">
            {(field) => <Input {...field} name="title" placeholder="Untitled document" />}
          </FormField>
          <input type="hidden" name="folderId" value={folderId} />
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {offerGitBackedRetry && (
              <Button
                type="submit"
                name="storage"
                value="git"
                variant="secondary"
                disabled={pending}
              >
                Create as git-backed instead
              </Button>
            )}
            <Button type="submit" name="storage" value="db" disabled={pending}>
              {pending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
