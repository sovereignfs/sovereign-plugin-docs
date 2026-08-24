'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button, Dialog, FormField, Input, Select, Spinner, StatusBadge } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/context';
import type { FolderMemberRole } from '../_lib/folder-rules';
import type { FolderMemberView } from '../_lib/folder-sharing';
import styles from './FolderShareDialog.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

interface FolderShareDialogProps {
  open: boolean;
  onClose: () => void;
  listMembersAction: () => Promise<FolderMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  removeAction: (userId: string) => Promise<ActionResult>;
}

/**
 * Folder-level sharing — owner-only member management, a sibling to
 * `ShareDialog` (not a generic abstraction of it: same structure, but kept
 * independently evolvable). A folder member's role also grants them access
 * to every document already filed under the folder (the "shared folder"
 * model, see `documents.ts`'s `resolveDocumentRole`) — this dialog only
 * manages who's on the folder, not per-document sharing.
 */
export function FolderShareDialog({
  open,
  onClose,
  listMembersAction,
  searchUsersAction,
  inviteAction,
  removeAction,
}: FolderShareDialogProps) {
  const [members, setMembers] = useState<FolderMemberView[] | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [inviteState, inviteFormAction, invitePending] = useActionState<
    ActionResult | null,
    FormData
  >(inviteAction, null);

  function refreshMembers() {
    listMembersAction().then(setMembers);
  }

  useEffect(() => {
    if (!open) {
      setMembers(null);
      setRemoveError(null);
      return;
    }
    refreshMembers();
    // refreshMembers wraps a stable bound action; keying only on `open` (not
    // re-created each render) avoids a fetch loop.
  }, [open]);

  useEffect(() => {
    if (inviteState?.ok) {
      setSelected(null);
      setQuery('');
      setResults([]);
      formRef.current?.reset();
      refreshMembers();
    }
  }, [inviteState]);

  useEffect(() => {
    if (selected || query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsersAction(query.trim())
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, searchUsersAction]);

  async function handleRemove(userId: string) {
    setRemoveError(null);
    const result = await removeAction(userId);
    if (result.ok) {
      refreshMembers();
    } else {
      setRemoveError(result.error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="md" title="Share">
      <div className={styles.body}>
        {members === null ? (
          <Spinner />
        ) : (
          <ul className={styles.members}>
            {members.map((member) => (
              <li key={member.userId} className={styles.member}>
                <div>
                  <p className={styles.memberName}>{member.name ?? member.email}</p>
                  {member.name ? <p className={styles.memberEmail}>{member.email}</p> : null}
                </div>
                <div className={styles.memberActions}>
                  <StatusBadge status="unmodified">{formatRole(member.role)}</StatusBadge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(member.userId)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {removeError ? (
          <p className={styles.error} role="alert">
            {removeError}
          </p>
        ) : null}

        <form ref={formRef} action={inviteFormAction} className={styles.inviteForm}>
          <input type="hidden" name="userId" value={selected?.id ?? ''} />
          <FormField label="Person" hint={selected ? undefined : 'Search by name or email'}>
            {(field) => (
              <div className={styles.picker}>
                <Input
                  {...field}
                  value={selected ? (selected.name ?? selected.email) : query}
                  onChange={(event) => {
                    setSelected(null);
                    setQuery(event.currentTarget.value);
                  }}
                  placeholder="Search by name or email"
                  autoComplete="off"
                />
                {results.length > 0 && !selected ? (
                  <ul className={styles.results}>
                    {results.map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(user);
                            setResults([]);
                          }}
                        >
                          {user.name ?? user.email}
                          {user.name ? ` (${user.email})` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </FormField>
          <FormField label="Role">
            {(field) => (
              <Select {...field} name="role" defaultValue="viewer">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </Select>
            )}
          </FormField>
          {inviteState && !inviteState.ok ? (
            <p className={styles.error} role="alert">
              {inviteState.error}
            </p>
          ) : null}
          <Button type="submit" disabled={!selected || invitePending}>
            {invitePending ? 'Adding…' : 'Add person'}
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

function formatRole(role: FolderMemberRole) {
  if (role === 'owner') return 'Owner';
  if (role === 'editor') return 'Editor';
  return 'Viewer';
}
