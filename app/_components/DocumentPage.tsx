'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { Button, Input, SegmentedControl, Textarea } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/context';
import type { DocumentRevision } from '../_lib/git-sync';
import type { DefaultView } from '../_lib/prefs';
import type { DocumentMemberView } from '../_lib/sharing';
import { RevisionsPanel } from './RevisionsPanel';
import { RichTextEditor } from './RichTextEditor';
import { ShareDialog } from './ShareDialog';
import styles from './DocumentPage.module.css';

const AUTOSAVE_IDLE_MS = 2000;

type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';
type Mode = 'view' | 'edit';
type Storage = 'db' | 'git';
type SyncStatus = 'synced' | 'pending' | 'conflict' | null;

interface DocumentPageProps {
  title: string;
  slug: string;
  content: string;
  storage: Storage;
  syncStatus: SyncStatus;
  /** Whether the current user has a connected Git drive — gates offering "Sync to Git" at all. */
  driveConnected: boolean;
  canEdit: boolean;
  /** Whether the current user's role is 'owner' — gates the Share button/dialog (D-13). */
  isOwner: boolean;
  defaultView: DefaultView;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  setDefaultViewAction: (view: DefaultView) => Promise<void>;
  syncAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  listRevisionsAction: () => Promise<DocumentRevision[]>;
  getRevisionContentAction: (sha: string) => Promise<string | null>;
  listMembersAction: () => Promise<DocumentMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteMemberAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  removeMemberAction: (userId: string) => Promise<ActionResult>;
}

const VIEW_OPTIONS: { label: string; value: DefaultView }[] = [
  { label: 'Markdown', value: 'markdown' },
  { label: 'Rich text', value: 'wysiwyg' },
];

const MODE_OPTIONS: { label: string; value: Mode }[] = [
  { label: 'View', value: 'view' },
  { label: 'Edit', value: 'edit' },
];

/**
 * Document viewer + editor (D-08/D-10/D-11) with the opt-in Git tier
 * (D-12). Markdown (`content`) is always the single source of truth and
 * lives here, not inside a child editor component — lifted up so switching
 * between the read-only viewer and the editor never loses in-progress
 * edits, and so the WYSIWYG view (a separate component reading `content`
 * once at mount) always remounts fresh from whatever the current value is
 * rather than needing to reactively sync a ProseMirror doc against
 * external changes.
 *
 * Opens in **view mode** by default (SPEC.md DOCS-08/DOCS-09) — the edit
 * toggle only renders when `canEdit` is true (owner/editor `docs_document_members`
 * role; a shared viewer sees the read-only surface with no edit affordance).
 * The Share button/dialog (D-13) is gated tighter still, on `isOwner` — only
 * an owner manages membership, matching `sovereign-plainwrite`'s precedent.
 *
 * "Sync to Git" (`syncAction`) does double duty as SPEC.md's "create-as-git
 * / mark-as-git" and "Sync to Git" in one action — see git-sync.ts for why a
 * document is never left half-converted (git storage with nothing actually
 * pushed).
 */
export function DocumentPage({
  title: initialTitle,
  slug,
  content: initialContent,
  storage,
  syncStatus: initialSyncStatus,
  driveConnected,
  canEdit,
  isOwner,
  defaultView,
  saveAction,
  setDefaultViewAction,
  syncAction,
  listRevisionsAction,
  getRevisionContentAction,
  listMembersAction,
  searchUsersAction,
  inviteMemberAction,
  removeMemberAction,
}: DocumentPageProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [lastSaved, setLastSaved] = useState({ title: initialTitle, content: initialContent });
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [view, setView] = useState<DefaultView>(defaultView);
  const [mode, setMode] = useState<Mode>('view');
  const [storageTier, setStorageTier] = useState<Storage>(storage);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initialSyncStatus);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [syncState, syncFormAction, syncPending] = useActionState<ActionResult | null, FormData>(
    syncAction,
    null,
  );

  const isEditing = canEdit && mode === 'edit';
  const isDirty = title !== lastSaved.title || content !== lastSaved.content;

  useEffect(() => {
    if (syncState?.ok) {
      setStorageTier('git');
      setSyncStatus('synced');
    }
  }, [syncState]);

  // Warn on tab close while an edit hasn't been autosaved yet.
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isEditing || !isDirty) return;
    const timer = setTimeout(() => {
      setAutosaveState('saving');
      const formData = new FormData();
      formData.set('title', title);
      formData.set('content', content);
      saveAction(formData)
        .then((result) => {
          if (result.ok) {
            setLastSaved({ title, content });
            setAutosaveState('saved');
            if (storageTier === 'git') setSyncStatus('pending');
          } else {
            setAutosaveState('error');
          }
        })
        .catch(() => setAutosaveState('error'));
    }, AUTOSAVE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [title, content, isDirty, isEditing, saveAction, storageTier]);

  function handleViewChange(next: DefaultView) {
    setView(next);
    // Fire-and-forget: the toggle itself is the confirmation: a failed
    // preference save just means it doesn't stick next visit, not worth
    // blocking or erroring the editor over.
    void setDefaultViewAction(next);
  }

  function handleDownload() {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link href="/docs" className={styles.backLink}>
          ← Docs
        </Link>
        <div className={styles.status}>
          {storageTier === 'git' ? (
            <span className={styles.badge} title={syncStatusLabel(syncStatus)}>
              Git · {syncStatusLabel(syncStatus)}
            </span>
          ) : null}
          {isEditing && autosaveState !== 'idle' ? (
            <span
              className={styles.autosaveStatus}
              role={autosaveState === 'error' ? 'alert' : undefined}
            >
              {autosaveLabel(autosaveState)}
            </span>
          ) : null}
          {canEdit && driveConnected && (
            <form action={syncFormAction}>
              <Button type="submit" variant="secondary" size="sm" disabled={syncPending}>
                {syncPending ? 'Syncing…' : 'Sync to Git'}
              </Button>
            </form>
          )}
          {storageTier === 'git' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRevisionsOpen(true)}
            >
              Revisions
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={handleDownload}>
            Download .md
          </Button>
          {isOwner && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
              Share
            </Button>
          )}
          {canEdit && (
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={MODE_OPTIONS}
              size="sm"
              aria-label="View or edit"
            />
          )}
        </div>
      </div>

      {syncState && !syncState.ok ? (
        <p className={styles.syncError} role="alert">
          {syncState.error}
        </p>
      ) : null}

      <Input
        className={styles.title}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Untitled document"
        aria-label="Document title"
        readOnly={!isEditing}
      />

      {isEditing && (
        <SegmentedControl
          value={view}
          onChange={handleViewChange}
          options={VIEW_OPTIONS}
          size="sm"
          aria-label="Editor view"
        />
      )}

      {!isEditing ? (
        <RichTextEditor content={content} onChange={setContent} readOnly showToolbar={false} />
      ) : view === 'markdown' ? (
        <Textarea
          className={styles.body}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Start writing in Markdown…"
          aria-label="Document content"
          rows={24}
        />
      ) : (
        // Conditional rendering (not a `key`) is what remounts this fresh
        // from the latest `content` on every markdown→wysiwyg switch — no
        // explicit key needed, and a content-derived key would wrongly
        // remount (losing cursor position) on every keystroke instead.
        <RichTextEditor content={content} onChange={setContent} readOnly={false} />
      )}

      <RevisionsPanel
        open={revisionsOpen}
        onClose={() => setRevisionsOpen(false)}
        listRevisionsAction={listRevisionsAction}
        getRevisionContentAction={getRevisionContentAction}
      />

      {isOwner && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          listMembersAction={listMembersAction}
          searchUsersAction={searchUsersAction}
          inviteAction={inviteMemberAction}
          removeAction={removeMemberAction}
        />
      )}
    </div>
  );
}

function autosaveLabel(state: AutosaveState) {
  if (state === 'saving') return 'Saving…';
  if (state === 'saved') return 'All changes saved';
  if (state === 'error') return 'Autosave failed — check your connection.';
  return null;
}

function syncStatusLabel(status: SyncStatus) {
  if (status === 'pending') return 'Not yet synced';
  if (status === 'conflict') return 'Sync conflict';
  return 'Synced';
}
