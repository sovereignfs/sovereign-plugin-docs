'use client';

import Link from 'next/link';
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Icon, Input, Menu, SegmentedControl, Textarea } from '@sovereignfs/ui';
import type { MenuEntry } from '@sovereignfs/ui';
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [syncState, syncFormAction, syncPending] = useActionState<ActionResult | null, FormData>(
    syncAction,
    null,
  );
  // The overflow menu's "Sync to Git" item dispatches this hidden form
  // rather than rendering its own `<form>` — a `Menu` item is a plain
  // button with an `onSelect` callback, not a submit control, so the actual
  // `useActionState`-bound submission still needs a real `<form action>` to
  // fire against; `requestSubmit()` triggers it programmatically.
  const syncFormRef = useRef<HTMLFormElement>(null);
  // Portal target for RichTextEditor's formatting ribbon — a `useState`
  // (not `useRef`) because the ribbon needs to re-render once the DOM node
  // actually exists, which a plain ref update wouldn't trigger. Set via a
  // ref callback below on `.toolbarBar`, a full-width bar rendered as a
  // sibling of `.secondaryHeader`, both inside one shared `position: sticky`
  // wrapper (`.stickyChrome`) — see RichTextEditor.tsx's top comment for why
  // this replaced an earlier JS-measured-height approach that kept going
  // stale for one new reason after another.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  // Auto-width title input — a native `<input>` never sizes itself to its
  // own value (that's not a thing `width` can express), so `.titleMirror`
  // (DocumentPage.module.css) is an invisible span rendering the same text
  // in the same font/padding/border purely to be measured; its rendered
  // width becomes the input's own `width` below. Recomputed on every
  // keystroke via `useLayoutEffect` so the input never visibly lags a frame
  // behind the mirror before resizing.
  const titleMirrorRef = useRef<HTMLSpanElement>(null);
  const [titleInputWidth, setTitleInputWidth] = useState<number>();

  const isEditing = canEdit && mode === 'edit';
  const isDirty = title !== lastSaved.title || content !== lastSaved.content;

  useLayoutEffect(() => {
    const el = titleMirrorRef.current;
    if (!el) return;
    setTitleInputWidth(el.offsetWidth);
  }, [title]);

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

  const statusLine = statusLineText({
    storageTier,
    syncStatus,
    isEditing,
    autosaveState,
    syncPending,
  });

  // Download is its own button (below), not a menu item — Sync/Revisions
  // are the only candidates left for the overflow menu, so it's built fresh
  // on every render (not memoized: cheap, and a `useMemo` deps array
  // covering canEdit/driveConnected/storageTier/syncPending is more to keep
  // in sync than it's worth for a 0-2-item list) and only rendered at all
  // once it actually has something in it.
  const overflowItems: MenuEntry[] = [
    ...(canEdit && driveConnected
      ? ([
          {
            label: syncPending ? 'Syncing…' : 'Sync to Git',
            icon: 'refresh-cw',
            disabled: syncPending,
            onSelect: () => syncFormRef.current?.requestSubmit(),
          },
        ] satisfies MenuEntry[])
      : []),
    ...(storageTier === 'git'
      ? ([
          {
            label: 'Revisions',
            icon: 'history',
            onSelect: () => setRevisionsOpen(true),
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  return (
    <>
      {/* One shared `position: sticky` wrapper around the secondary header
          (title/view/edit row) and, while editing in Rich text, a full-width
          toolbar bar directly beneath it — `.body` (docs.module.css, the
          plugin shell's own scroll container) is this wrapper's nearest
          scrolling ancestor, so `top: 0` pins the whole thing in place under
          DocsHeader as the document scrolls, the same way DocsHeader is
          already pinned above it (by living outside `.body` entirely). Both
          children are plain, non-sticky, in-flow content — their relative
          spacing is ordinary CSS, not a JS-measured offset (see
          RichTextEditor.tsx's top comment for the approach this replaced and
          why). */}
      <div className={styles.stickyChrome}>
        <div className={styles.secondaryHeader}>
          <div className={styles.metaBar}>
            <Link href="/docs" className={styles.backLink} aria-label="Back to Docs">
              <Icon name="chevron-left" size="md" aria-hidden />
          </Link>

          <div className={styles.titleBlock}>
            {/* Not `display: flex` — see `.titleBlock`'s own comment in
                DocumentPage.module.css for the Chromium rendering bug this
                sidesteps. `.titleMirror` is invisible, off-screen, and exists
                purely to be measured (see the `titleMirrorRef` comment
                above) — same text as the input (or its placeholder, so an
                empty title still reserves room for "Untitled document"
                rather than collapsing to zero width). */}
            <span ref={titleMirrorRef} className={styles.titleMirror} aria-hidden="true">
              {title || 'Untitled document'}
            </span>
            <div
              className={styles.titleInputWrap}
              style={titleInputWidth ? { width: titleInputWidth } : undefined}
            >
              <Input
                name="documentTitle"
                className={styles.title}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Untitled document"
                aria-label="Document title"
                readOnly={!isEditing}
              />
            </div>
            {statusLine && (
              <p
                className={styles.statusLine}
                role={autosaveState === 'error' ? 'alert' : undefined}
              >
                <span aria-hidden="true">· </span>
                {statusLine}
              </p>
            )}
          </div>

          <div className={styles.metaRight}>
            {isEditing && (
              <SegmentedControl
                value={view}
                onChange={handleViewChange}
                options={VIEW_OPTIONS}
                size="sm"
                aria-label="Editor view"
              />
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
            {/* Not rendered by the menu item itself — `Menu` items are plain
                buttons with `onSelect`, not submit controls, so the real
                `useActionState`-bound submission still needs an actual
                `<form action>` to fire against. */}
            <form ref={syncFormRef} action={syncFormAction} className={styles.hiddenForm} />
            <Button type="button" variant="secondary" size="sm" onClick={handleDownload}>
              Download
            </Button>
            {overflowItems.length > 0 && (
              <Menu
                aria-label="More actions"
                open={overflowOpen}
                onClose={() => setOverflowOpen(false)}
                align="right"
                trigger={
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={overflowOpen}
                    onClick={() => setOverflowOpen((v) => !v)}
                  >
                    <Icon name="ellipsis-vertical" size="sm" aria-hidden />
                  </button>
                }
                items={overflowItems}
              />
            )}
            {isOwner && (
              <Button type="button" size="sm" onClick={() => setShareOpen(true)}>
                Share
              </Button>
            )}
          </div>
        </div>
        {/* Full-width toolbar bar, only while actually editing in Rich text
            — the portal target RichTextEditor's formatting ribbon renders
            into (see the top comment above and RichTextEditor.tsx's own).
            A ref callback (not `useRef`) so the ribbon can react once this
            node actually exists in the DOM. No `role`/`aria-label` here —
            the ribbon's own portaled root already carries
            `role="toolbar"`; this is just its plain layout container. */}
        {isEditing && view === 'wysiwyg' && (
          <div ref={setToolbarSlot} className={styles.toolbarBar} />
        )}
      </div>
      {/* end secondaryHeader */}
      </div>
      {/* end stickyChrome */}

      {syncState && !syncState.ok ? (
        <p className={styles.syncError} role="alert">
          {syncState.error}
        </p>
      ) : null}

      {/* Full-width "desk" background — deliberately not capped at `.page`'s
          900px, matching Google Docs' own canvas (the grey surface runs the
          full browser width; only the white page/`.pageCard` inside it is
          centered at a reading width). */}
      <div className={styles.canvas}>
        <div className={styles.pageCard}>
          {!isEditing ? (
            <RichTextEditor content={content} onChange={setContent} readOnly />
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
            <RichTextEditor
              content={content}
              onChange={setContent}
              readOnly={false}
              toolbarContainer={toolbarSlot}
            />
          )}
        </div>
      </div>

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
    </>
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

/** The single small caption line under the title — combines the git badge,
 *  autosave state, and sync-in-progress state rather than stacking separate
 *  status regions, matching the compact single-row meta bar (see the
 *  "closing the gap with Google Docs" strategy doc). `syncPending` is
 *  surfaced here rather than as a button label — now that "Sync to Git"
 *  lives inside the overflow menu, closed the instant it's selected, its
 *  own label has nowhere to show "Syncing…" while the request is in flight. */
function statusLineText({
  storageTier,
  syncStatus,
  isEditing,
  autosaveState,
  syncPending,
}: {
  storageTier: Storage;
  syncStatus: SyncStatus;
  isEditing: boolean;
  autosaveState: AutosaveState;
  syncPending: boolean;
}): string | null {
  const parts: string[] = [];
  if (syncPending) parts.push('Syncing…');
  if (storageTier === 'git') parts.push(`Git · ${syncStatusLabel(syncStatus)}`);
  if (isEditing) {
    const autosave = autosaveLabel(autosaveState);
    if (autosave) parts.push(autosave);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
