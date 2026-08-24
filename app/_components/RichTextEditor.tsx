'use client';

import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { Icon, Menu, Tooltip, type IconName } from '@sovereignfs/ui';
import styles from './RichTextEditor.module.css';

interface RichTextEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  readOnly: boolean;
  /** DOM node the formatting ribbon portals into — DocumentPage's full-width
   *  toolbar bar, sharing one sticky wrapper with its own secondary header
   *  (see this file's top comment for why). Omitted for the read-only viewer
   *  (D-11), which has no toolbar bar to portal into and nothing for a
   *  disabled ribbon to do there. */
  toolbarContainer?: HTMLElement | null;
}

/**
 * The WYSIWYG view (D-10) — a rich-text surface over the same Markdown
 * `docs_documents.content` the Markdown view edits directly. Markdown stays
 * the single source of truth: this component only reads `content` once, at
 * mount (TipTap's `content` prop), so switching views remounts it fresh from
 * whatever the Markdown textarea currently holds rather than needing to
 * reactively sync a ProseMirror doc against external changes — DocumentPage
 * renders a fresh `<RichTextEditor>` element on the Markdown → Rich text
 * transition (a different component type than the `<Textarea>` it replaces,
 * so React remounts it there), but the View → Edit toggle for a document
 * whose default view is already "Rich text" goes directly between this
 * component's own two call sites (readOnly viewer → editable), which is the
 * SAME element type at the SAME position — React reuses the instance and
 * only updates props, it does not remount. `editable` below is a real prop
 * that must react to that case explicitly (see the `useEffect` below) —
 * `useEditor`'s `editable` option is read once at construction only ("Fixed
 * editing not working" investigation: `contenteditable` stayed `false`
 * after Edit was clicked whenever a document's saved view preference was
 * already "Rich text", since that toggle never remounts).
 *
 * StarterKit (Tiptap v3) already bundles everything the toolbar below needs
 * — bold/italic/underline/strike/headings/lists/links/code — with no extra
 * `@tiptap/extension-*` packages required.
 *
 * Toolbar (icon ribbon, replacing the earlier text-glyph buttons — see the
 * "Docs editor: closing the gap with Google Docs" strategy doc): a
 * paragraph-style menu, then grouped icon buttons, mirroring Google Docs'
 * single-ribbon shape while staying on `@sovereignfs/ui` DS primitives
 * (`Icon`, `Menu`, `Tooltip`) and semantic tokens throughout — no font
 * picker, no color/highlight swatches (the v1 identity is monochrome, no
 * color-literal palette to draw from). Bold/Italic/Underline/Strikethrough
 * stay styled letterforms rather than icons — cheap, legible, and avoids
 * inventing glyphs for concepts a single character already communicates
 * clearly.
 *
 * The ribbon itself renders via `createPortal` into `toolbarContainer` — a
 * full-width bar DocumentPage renders as a sibling of its own secondary
 * header (title/view/edit row), both wrapped in one shared `position:
 * sticky` container. Earlier this rendered inline here instead, with its own
 * independent `position: sticky` trying to dock itself directly beneath the
 * header via a JS-measured `--docs-toolbar-sticky-top` custom property
 * (the header's height, published from a `ResizeObserver`-adjacent
 * mechanism). That measurement kept going stale for one new reason after
 * another — the autosave caption rendering a beat after `isEditing` flips,
 * the header wrapping to two lines at a narrower width — because chasing
 * "whatever can change the header's height" is an open-ended list, not a
 * fixed one. Two elements sharing one sticky ancestor need no measurement at
 * all: their relative spacing is just ordinary CSS flow, correct by
 * construction instead of correct until the next edge case. The portal is
 * what makes that possible without moving `editor` (and its Rules-of-Hooks
 * mount lifecycle — see the paragraph above on remounting fresh from
 * `content`) out of this component.
 *
 * `html: false` on the Markdown extension is a deliberate security choice,
 * not the library default (`true`): it keeps raw HTML embedded in a
 * document's Markdown from being parsed into live DOM nodes here.
 */
export function RichTextEditor({
  content,
  onChange,
  readOnly,
  toolbarContainer,
}: RichTextEditorProps) {
  const editor = useEditor({
    // Next.js SSR: without this, TipTap tries to render on the server,
    // which produces a hydration mismatch on a component that's genuinely
    // client-only.
    immediatelyRender: false,
    content,
    editable: !readOnly,
    extensions: [
      StarterKit,
      // Resizing (drag handles, `colgroup`/`col` width tracking) deliberately
      // left off for v1 — the petition.lk port that motivated table support
      // only needed plain GFM-shaped tables (uniform columns, a header row,
      // no merged cells), and resizing is real added interaction surface
      // (drag CSS, width persistence) that isn't needed to close that gap.
      // `tiptap-markdown` already bundles Markdown parse/serialize rules for
      // the standard `table`/`tableRow`/`tableHeader`/`tableCell` node names
      // these extensions register under — no extra markdown wiring needed.
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        transformPastedText: true,
      }),
    ],
    onUpdate: ({ editor: instance }) => {
      const markdownStorage = instance.storage as unknown as { markdown: MarkdownStorage };
      onChange(markdownStorage.markdown.getMarkdown());
    },
    editorProps: {
      attributes: {
        class: styles.prose ?? '',
        'aria-label': 'Document content',
      },
    },
  });

  // `useEditor`'s `editable` option is only read when the TipTap `Editor`
  // instance is constructed — `useEditor` takes no `deps` array here, so it
  // never recreates. When this component is reused in place across a
  // View → Edit toggle (see the doc comment above), `readOnly` changing is
  // an ordinary prop update that never reaches TipTap's own editable state
  // without this — `setEditable` is TipTap's own supported way to change it
  // after construction.
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) {
    return <div className={styles.loading}>Loading editor…</div>;
  }

  return (
    <div className={styles.shell}>
      {toolbarContainer &&
        createPortal(<FormattingRibbon editor={editor} readOnly={readOnly} />, toolbarContainer)}
      <EditorContent editor={editor} className={styles.content} />
    </div>
  );
}

// Levels 4/5 are given over to "Title"/"Subtitle" rather than a literal 4th/
// 5th outline heading, matching Google Docs' own paragraph-style menu
// (Normal text / Title / Subtitle / Heading 1-3). Deliberately NOT levels 1/2
// (which would collide with the existing Heading 1/Heading 2 mapping and
// silently reinterpret every `#`/`##` in already-authored documents) — H1-H3
// keep their current meaning untouched; Title/Subtitle just borrow otherwise
// idle, already-enabled heading levels (StarterKit's Heading extension
// defaults to levels 1-6) purely as a serialization slot. Visual size is a
// pure CSS choice (RichTextEditor.module.css's `h4`/`h5` rules), independent
// of the markdown heading-level number, so "Title" reads bigger than
// "Heading 1" despite living at a nominally deeper level. Trade-off: a `.md`
// export opened in a third-party renderer (GitHub, VS Code preview) will
// show Title/Subtitle as small, deeply-nested headings rather than the large
// title treatment this app renders — not lossless outside this editor.
const PARAGRAPH_STYLES = [
  { label: 'Normal text', level: 0 },
  { label: 'Title', level: 4 },
  { label: 'Subtitle', level: 5 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const;

function FormattingRibbon({ editor, readOnly }: { editor: Editor; readOnly: boolean }) {
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);

  const activeStyle =
    PARAGRAPH_STYLES.find(
      (s) => s.level > 0 && editor.isActive('heading', { level: s.level }),
    ) ?? PARAGRAPH_STYLES[0];

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      <ToolbarIconButton
        label="Undo"
        icon="rotate-ccw"
        active={false}
        disabled={readOnly || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolbarIconButton
        label="Redo"
        icon="rotate-cw"
        active={false}
        disabled={readOnly || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
      <span className={styles.divider} aria-hidden="true" />

      <Menu
        aria-label="Paragraph style"
        open={styleMenuOpen}
        onClose={() => setStyleMenuOpen(false)}
        trigger={
          <button
            type="button"
            className={styles.styleTrigger}
            disabled={readOnly}
            aria-haspopup="menu"
            aria-expanded={styleMenuOpen}
            onClick={() => setStyleMenuOpen((v) => !v)}
          >
            {activeStyle.label}
            <Icon name="chevron-down" size="xs" aria-hidden />
          </button>
        }
        items={PARAGRAPH_STYLES.map((s) => ({
          label: s.label,
          checked: s.level === activeStyle.level,
          onSelect: () => {
            if (s.level === 0) {
              editor.chain().focus().setParagraph().run();
            } else {
              editor
                .chain()
                .focus()
                .toggleHeading({ level: s.level as 1 | 2 | 3 | 4 | 5 })
                .run();
            }
          },
        }))}
      />
      <span className={styles.divider} aria-hidden="true" />

      <ToolbarLetterButton
        label="Bold"
        active={editor.isActive('bold')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleBold().run()}
        style={{ fontWeight: 'var(--sv-font-weight-bold)' }}
      >
        B
      </ToolbarLetterButton>
      <ToolbarLetterButton
        label="Italic"
        active={editor.isActive('italic')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        style={{ fontStyle: 'italic' }}
      >
        I
      </ToolbarLetterButton>
      <ToolbarLetterButton
        label="Underline"
        active={editor.isActive('underline')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        style={{ textDecoration: 'underline' }}
      >
        U
      </ToolbarLetterButton>
      <ToolbarLetterButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        style={{ textDecoration: 'line-through' }}
      >
        S
      </ToolbarLetterButton>
      <span className={styles.divider} aria-hidden="true" />

      <ToolbarIconButton
        label="Bullet list"
        icon="list"
        active={editor.isActive('bulletList')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarIconButton
        label="Numbered list"
        icon="list-ordered"
        active={editor.isActive('orderedList')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <span className={styles.divider} aria-hidden="true" />

      <ToolbarIconButton
        label="Link"
        icon="link"
        active={editor.isActive('link')}
        disabled={readOnly}
        onClick={() => {
          const previousUrl = editor.getAttributes('link').href as string | undefined;
          const url = window.prompt('Link URL', previousUrl ?? 'https://');
          if (url === null) return;
          if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}
      />
      <ToolbarIconButton
        label="Code"
        icon="code"
        active={editor.isActive('code')}
        disabled={readOnly}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <span className={styles.divider} aria-hidden="true" />

      {/* Insertion, not a toggle — `active` has no real meaning for a
          horizontal rule (the cursor is never "inside" one the way it can
          be inside bold text or a link), so this always renders inactive,
          same as Undo/Redo. */}
      <ToolbarIconButton
        label="Divider"
        icon="minus"
        active={false}
        disabled={readOnly}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
      <span className={styles.divider} aria-hidden="true" />

      <TableMenuButton editor={editor} readOnly={readOnly} open={tableMenuOpen} setOpen={setTableMenuOpen} />
    </div>
  );
}

/**
 * Table menu — one trigger covering insert plus row/column/table operations,
 * rather than 7+ separate ever-visible ribbon buttons for actions that only
 * make sense while the cursor is already inside a table. Row/column/delete
 * items are `disabled` (not hidden) when `!editor.isActive('table')`, same
 * "grey out, don't reflow" convention the rest of the ribbon already uses for
 * `readOnly` — a fixed item count keeps the popover's height stable.
 */
function TableMenuButton({
  editor,
  readOnly,
  open,
  setOpen,
}: {
  editor: Editor;
  readOnly: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const inTable = editor.isActive('table');

  return (
    <Menu
      aria-label="Table"
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          aria-label="Table"
          className={styles.toolbarButton}
          disabled={readOnly}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="table" size="sm" aria-hidden />
        </button>
      }
      items={[
        {
          label: 'Insert table',
          icon: 'table',
          onSelect: () =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        },
        { type: 'separator' },
        {
          label: 'Add row above',
          icon: 'plus',
          disabled: !inTable,
          onSelect: () => editor.chain().focus().addRowBefore().run(),
        },
        {
          label: 'Add row below',
          icon: 'plus',
          disabled: !inTable,
          onSelect: () => editor.chain().focus().addRowAfter().run(),
        },
        {
          label: 'Add column left',
          icon: 'plus',
          disabled: !inTable,
          onSelect: () => editor.chain().focus().addColumnBefore().run(),
        },
        {
          label: 'Add column right',
          icon: 'plus',
          disabled: !inTable,
          onSelect: () => editor.chain().focus().addColumnAfter().run(),
        },
        { type: 'separator' },
        {
          label: 'Delete row',
          icon: 'trash-2',
          destructive: true,
          disabled: !inTable,
          onSelect: () => editor.chain().focus().deleteRow().run(),
        },
        {
          label: 'Delete column',
          icon: 'trash-2',
          destructive: true,
          disabled: !inTable,
          onSelect: () => editor.chain().focus().deleteColumn().run(),
        },
        {
          label: 'Delete table',
          icon: 'trash-2',
          destructive: true,
          disabled: !inTable,
          onSelect: () => editor.chain().focus().deleteTable().run(),
        },
      ]}
    />
  );
}

function ToolbarIconButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={active ? styles.toolbarButtonActive : styles.toolbarButton}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        <Icon name={icon} size="sm" aria-hidden />
      </button>
    </Tooltip>
  );
}

function ToolbarLetterButton({
  label,
  active,
  disabled,
  onClick,
  style,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  style: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={active ? styles.toolbarButtonActive : styles.toolbarButton}
        style={style}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
