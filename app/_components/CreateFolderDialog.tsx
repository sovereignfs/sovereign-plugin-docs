'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, Dialog, FormField, Input } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/context';
import { createFolder } from '../_lib/documents';
import styles from './DialogForm.module.css';

export function CreateFolderDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createFolder,
    null,
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        New folder
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="New folder">
        <form action={formAction} className={styles.form}>
          {state && !state.ok && (
            <p className={styles.feedbackError} role="status" aria-live="polite">
              {state.error}
            </p>
          )}
          <FormField label="Name" required>
            {(field) => <Input {...field} name="name" required placeholder="Handbook" />}
          </FormField>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create folder'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
