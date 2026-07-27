# Sovereign Docs — Roadmap

Chronological, dependency-ordered task queue for building the Sovereign Docs
plugin. Each task is scoped to **one branch = one PR**, small enough for an AI
agent to pick up with minimal supervision. Full requirements: [SPEC.md](SPEC.md).

## How to read this file

- **`[PLATFORM]`** tasks change the main **`claude-sv`** monorepo. They follow that
  repo's own `CLAUDE.md` / `docs/development-workflow.md` conventions. **Do these in
  the `claude-sv` repo, not here.**
- **`[PLUGIN]`** tasks change **this repo** (`sovereign-docs.local`, which becomes
  the public `sovereign-docs` repo).
- Tasks are **sequenced** — don't start a task whose `Depends on` isn't ✅, unless
  tagged `[parallel]`.
- Status: `⬜ not started` / `🟨 in progress` / `✅ done`.
- **The v0.3 local-first pivot** (see SPEC.md "What changed in v0.3") reframed the
  unbuilt Phase 1 tasks and renumbered the later platform/v0.2/v0.3 tasks. Completed
  tasks (D-00…D-04) keep their IDs and their historical changelog entries below.

---

## Phase 0 — Platform readiness `[PLATFORM]`

The platform already provides everything v0.1 needs: `sdk.env` (RFC 0018, quota),
`sdk.directory`, `sdk.secrets`, `sdk.connections`, `sdk.data`, `sdk.notifications`,
`sdk.storage`. Still genuinely absent: RFC 0042 (public routes) and RFC 0047
(`sdk.tools`). **No platform work blocks starting Phase 1.**

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D-00 | **[PLUGIN]** Bootstrap this repo: `package.json`, `tsconfig`, ESLint/Prettier, `manifest.json` skeleton, README. | — | ✅ |
| D-01 | **[PLATFORM]** Re-verify Phase 0 findings are still current (`sdk.env`/`sdk.connections`/`sdk.storage` implemented, RFC 0042 still Draft/no code, `sdk.tools` absent) immediately before Phase 2/3. No code change unless something regressed. | — | ⬜ |

---

## Phase 1 — Plugin v0.1 core (local-first, git optional) `[PLUGIN]`

Everything in this phase runs on primitives that already exist. The theme is
**local-first**: documents work with no git at all, bounded by the operator-set
quota; the git tier is opt-in and layered on last (D-12).

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D-02 | DB schema (original git-first model): `docs_drives`, `docs_projects`, `docs_documents`, `docs_drafts`, `docs_document_members`. Migration + Drizzle schema. | D-00 | ✅ |
| D-03 | Git provider adapter: `GitProvider` interface + `GitHubProvider` (list/read, publish single/multi, commits for revisions). Token-in, no OAuth. | D-02 | ✅ |
| D-04 | Drive-connect UI + server actions (GitHub **PAT**): store token via `sdk.secrets`, `sdk.connections` record, `docs_drives` row, `docs/.gitkeep` on connect, disconnect. **Now demoted to the opt-in tier** (see D-12) rather than a first-run gate. | D-03 | ✅ |
| D-05 | **Schema restructure for local-first** (SPEC "Data model"): fold canonical Markdown into `docs_documents.content`; add `storage` (`local`\|`git`), `git_path`/`base_sha`/`sync_status`/`last_synced_at`; **drop `docs_drafts`**; add `docs_user_prefs` (`default_view`). Regenerate SQLite + Postgres migrations (no shipped data to preserve). | D-02 | ✅ |
| D-06 | **Quota lib + manifest `env`**: add `FREE_DOC_LIMIT` to the manifest `env` field; `app/_lib/quota.ts` — read via `sdk.env.get`, parse int, default 25 on unset/invalid/≤0; a pure `canCreateLocalDocument(count, limit)` helper. Unit-tested independently of a request. | D-05 | ✅ |
| D-07 | **Create project / create document + quota gating**: name→slug, `docs_projects`/`docs_documents` rows, owner membership auto-insert. New docs default to `storage: 'local'`. Block local creation at the limit with a connect-a-drive prompt; if a drive is connected, offer to create git-backed instead. | D-06 | ✅ |
| D-08 | **Markdown editor + autosave**: minimalistic Markdown editor; **autosave** writes `docs_documents.content` (debounced; no explicit Save); autosave-state indicator ("Saving…"/"All changes saved"). | D-07 | ✅ |
| D-09 | **Document list / home (Drive-style)**: projects + documents owned by / shared with the user; "＋ Blank" create; project navigation; **search**; **quota indicator**; empty state. Google-Docs/Drive UX per SPEC "Editor and UI". | D-07 | ✅ |
| D-10 | **Per-user view preference + WYSIWYG view**: `docs_user_prefs.default_view`; a **Markdown ⇄ WYSIWYG** toggle over the same Markdown source (small feature set — bold/italic/underline/headings/lists/links/code); opening a doc honours the stored default. Round-trip fidelity is the key risk (SPEC open question 1). | D-08 | ✅ |
| D-11 | **Viewer + edit-mode toggle** (permission-gated read-only render); `.md` **export/download** (DOCS-11). | D-08 | ✅ |
| D-12 | **Opt-in git-backed tier**: move drive-connect into settings (not a gate); create-as-git / mark-as-git; **Sync to Git** (push `content` via the D-03 adapter, store `base_sha`, `sync_status`, conflict check); **git revisions panel** (commits filtered by path, render at a SHA). | D-04, D-08 | ✅ |
| D-13 | **Instance sharing**: share dialog using `sdk.directory`, `docs_document_members` roles, `sdk.mailer` + `sdk.notifications` alerts. | D-09 | ✅ |
| D-14 | **Portability + deletion**: export (metadata **+ content**, projects, prefs, shares, connection metadata — no credentials) and additive import; user-deletion handler (remove docs/prefs, disconnect connection, revoke shares, transfer/archive per membership). | D-05..D-13 | ✅ |
| D-15 | **v0.1 hardening pass**: tenant-scoping sweep across all `docs_*` tables; quota edge cases (limit change up/down, drive connect/disconnect); autosave failure + git error states (`sdk.connections.markError` → `needs_reauth`/`error`). | D-14 | ✅ |

**v0.1 is feature-complete — D-15 (the last task) shipped 2026-07-22.**

---

## Phase 2 — Platform prerequisite for public sharing `[PLATFORM]`

Must land in `claude-sv` **before** Phase 3's public-sharing task (D-17).

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D-16 | **[PLATFORM]** Implement RFC 0042 (public plugin page routes): a plugin-declared public page prefix, middleware exemption from the global session gate, plugin-owned token-or-session auth for the route (generalising the `apiProvider` public-API exemption to pages). Update the RFC status + `claude-sv` roadmap/epic. | — | ✅ |

---

## Phase 3 — Plugin v0.2 `[PLUGIN]`

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D-17 | **Public sharing**: `docs_public_shares` token registry, public document route (`/docs/p/<token>`) on RFC 0042, expiring-by-default TTL sweep, permanent opt-in. | D-16, D-15 | ⬜ |
| D-18 | **GitHub OAuth** drive connection (browser flow, alongside PAT) on `sdk.connections.createOAuthState`/`verifyOAuthState` + a manifest `connections.providers` entry (callback path, scopes, instance `config.public`/`config.secrets`). | D-12 | ⬜ |

_(The former standalone "rich-text editor toggle" task is absorbed into D-10 — the
WYSIWYG view is part of the v0.1 editor now, not a v0.2 add-on.)_

---

## Phase 5 — Plugin v0.3 `[PLUGIN]`

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D-19 | **Images/assets** via `sdk.storage` (adds `storage:readWrite` to the manifest — not present in v0.1); relative-path resolution in editor + public render (SPEC open question 7). | D-10 | ⬜ |
| D-20 | **Permanent-public performance**: cache/pre-render strategy for permanent public docs (SPEC open question 6). | D-17 | ⬜ |
| D-21 | **External-edit conflict resolution UI**: surface base-SHA conflicts from D-12 with overwrite/branch/merge options. | D-12 | ⬜ |

**v1.0 stable once D-19–D-21 are done and a hardening/docs pass is complete.**

---

## Phase 6 — Post-v1 (not sequenced)

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D-22 | **[PLUGIN]** Multiple repos — drive selection per project/document; migrate local↔git (SPEC open question 5). | v1.0 | ⬜ |
| D-23 | **[PLUGIN]** Document-content E2EE on top of `sdk.e2ee` (RFC 0060, implemented) — per-document encrypt/decrypt in the browser. | v1.0 | ⬜ |
| D-24 | **[PLUGIN]** GitLab / Gitea provider adapters (implement `GitProvider` for each). | v1.0 | ⬜ |
| D-25 | **[PLATFORM]** RFC 0047 (`sdk.tools`) — once the platform prioritizes assistant/automation tool contracts; wire "create document"/"sync draft" as confirmed actions. | — | ⬜ |
| D-26 | **[PLUGIN/PLATFORM]** Local version history for local docs (periodic DB snapshots) — Google-Docs-style history without git (SPEC open question 2). | v1.0 | ⬜ |

---

## Deferred / optional (not blocking)

- **D-00-ci** — A CI workflow for this repo. Deferred as premature relative to its
  value; neither sibling reference plugin has one yet.
- **D-16-shared** — Extract the `GitProvider` REST adapter (D-03) into a shared
  package usable by Sovereign Docs and Plainwrite. Only after both adapters
  stabilise.
- **Console-managed `FREE_DOC_LIMIT`** — a runtime admin override for the quota
  (env var is deploy-time only in v1). SPEC open question 3.

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-07-27 | **Renamed the `local` storage tier to `db`** (`docs_documents.storage: 'db' \| 'git'`, was `'local' \| 'git'`) across the schema (`app/_db/schema.ts`, `db/schema.postgres.ts`, both `0000` migrations + snapshots — no shipped data to preserve, so edited in place rather than adding a conversion migration), `document-rules.ts`/`quota.ts` (`canCreateLocalDocument` → `canCreateDbDocument`, `localDocumentCount` → `dbDocumentCount`), `documents.ts`/`git-sync.ts`/`portability.ts`/`DocumentPage.tsx`/`DocumentsList.tsx`/`CreateDocumentDialog.tsx` (`localCount` → `dbCount` and every `'local'` literal), and the corresponding tests. Prompted by a naming-accuracy review of the plugin's own description: "local-first" claimed a client-side/offline storage architecture this plugin never had — every document lives in the platform's own tenant-scoped database from the start, never on the user's device — and the `'local'` enum value inherited the same inaccuracy. Description updated to **"A privacy-first document workspace."** in `manifest.json`, `README.md`, and `SPEC.md`'s overview line; README's "Local (default, free)" tier label became "Database (default, free)". Typecheck, lint, format, and all 55 tests verified clean after the rename. Not yet committed. |
| 2026-07-27 | Marked **D-16 done** without new plugin work: verified against the platform repo that RFC 0042 (public plugin page routes) already shipped there as epic task 2.14 / roadmap slot 0.41.0, ✅ before this plugin's Phase 2 was reached. Confirmed the manifest `publicRoutes` field (`packages/manifest/src/schema.ts`, prefix must start with `/`, can't be `/`, no `..` segments, no route-group/interception markers, unique per plugin) and the middleware exemption resolving `publicRoutes[].prefix` relative to a plugin's `routePrefix` (`runtime/src/route-guard.ts`), each with direct test coverage (`route-guard.test.ts`, `middleware-regression.test.ts`, `packages/manifest/src/__tests__/validate.test.ts`) matching this task's review checklist (unauthenticated access to declared routes only, undeclared routes still redirect, reserved paths can't be shadowed). D-17 (public sharing) is now unblocked on the D-16 side; D-15 was already ✅. |
| 2026-07-22 | Completed **D-15 v0.1 hardening pass — v0.1 is now feature-complete**. Tenant-scoping sweep across every `docs_*` query site in the plugin found one real gap: `app/_lib/actions.ts`'s three `docs_drives` queries (`getDrive`, `connectDrive`, `disconnectDrive`) filtered only by `userId`, unlike every other query in the plugin (`documents.ts`, `sharing.ts`, `git-sync.ts`, `prefs.ts`, `portability.ts`), which consistently filter by both `tenantId` and `userId` — fixed to match. `syncDocumentToGit`'s error handling only ever called `sdk.connections.markError` for a 401/403 (→ `needs_reauth`); any other GitHub API failure (404/422/5xx) left the connection's status as "connected" even though the sync had actually failed, with no signal on the Settings page — now marks the connection `'error'` for those cases, leaving the existing 409-on-a-git-doc handling (a content conflict, not a connection problem) and the `needs_reauth` branch as they were. Reviewed the quota edge cases named in this task's scope (limit lowered below a user's existing document count; drive connect/disconnect around git-backed documents) and confirmed both already degrade correctly without further changes: a lowered limit only blocks new local-document creation without touching existing documents (`canCreateLocalDocument`/`resolveDocumentStorage` are pure count-vs-limit comparisons with no assumption the count stays under the limit), and a disconnected drive's git-backed documents surface a clear "reconnect" error on sync (`resolveGitContext`) rather than silently failing. Verified in the browser: Settings and the Docs home both render correctly post-fix with no server errors, confirming the now-tenant-scoped `getDrive()` query still resolves correctly. Version 0.3.0 → 0.3.1 (fix, patch). |
| 2026-07-22 | Completed **D-14 portability + deletion**. Rewrote `app/_lib/portability.ts` to cover everything shipped through D-13, which the D-05-era handlers predated. Export now includes `docs_user_prefs.default_view` and each document's git-sync fields, and `documentMembers` widens from "your own membership rows" to the full member list of every document you own plus your own rows on documents shared with you (schema version 2 → 3). Import now inserts an owner `docs_document_members` row for every restored document — a real gap this surfaced: without it, an imported document had no membership row at all and was unreachable, since `getDocumentForEdit`/`listDocumentsOverview` both read through that table, not `ownerId`. Deletion no longer hard-deletes every document a user owns outright: a document with other members now transfers ownership to the longest-tenured remaining member (or an existing co-owner) instead of deleting it out from under them, per SPEC.md's "transfers or archives shared documents according to membership"; only a sole owner's document is still hard-deleted, and a share on someone else's document just drops the membership row. Deletion also now disconnects the drive's `sdk.connections` record (best-effort, collected into `DeletionResult.errors`) before removing the local `docs_drives` row — previously left dangling. Updated `portability.test.ts`'s fixtures and expectations for the new schema/behavior (55 tests total). Verified live: exported real seeded account data through `/account/data`'s "Export as ZIP" and confirmed a clean 200 with no server errors; the import/deletion transfer paths aren't reachable through a simple browser interaction (file upload, admin-triggered account deletion) so they rely on the rewritten unit tests, which exercise the exact transfer-vs-hard-delete and owner-row-on-import scenarios directly against the real Drizzle query shapes. Version 0.2.0 → 0.3.0 (feat, minor). |
| 2026-07-20 | Completed **D-13 instance sharing**. Added `app/_lib/sharing.ts`: `inviteDocumentMember` (owner-only upsert — invites a new member or changes an existing one's role in one action, ported from `sovereign-plainwrite`'s `inviteProjectMember`), `removeDocumentMember` (blocks removing the last owner), `listDocumentMembers`, `searchDocumentDirectoryUsers` (the share dialog's `sdk.directory` typeahead). A new member gets a best-effort in-app notification (`sdk.notifications`) and email (`sdk.mailer`). Added `ShareDialog.tsx` (owner-only, ported from Plainwrite's `InviteMemberForm`) and a "Share" button on `DocumentPage` gated on a new `isOwner` prop (`getDocumentForEdit` now also returns the caller's `docs_document_members` role). **Fixed a real gap this surfaced**: `listDocumentsOverview` only ever queried documents by `ownerId`, so a shared document had no way to ever appear in the recipient's list — now reads through `docs_document_members` and shows shared documents with a "Shared" badge, regardless of `projectId` (the recipient has no access to the owner's project to browse into). Extracted `isDocumentMemberRole` into `document-rules.ts` alongside the existing `DocumentMemberRole`/`canEditRole`. 2 new unit tests (57 total). Verified end-to-end in the browser with two real seeded accounts: shared a document as Viewer, confirmed it appeared in the recipient's list with a "Shared" badge and no quota impact, confirmed the in-app notification arrived, confirmed the recipient had no Edit/Share affordances, then promoted them to Editor and confirmed the Edit toggle appeared immediately (Share stayed hidden). No console/server errors; checked at 375px. |
| 2026-07-20 | Completed **D-12 opt-in git-backed tier**. Added `app/_lib/git-sync.ts`: `syncDocumentToGit` (combines SPEC.md's "create-as-git/mark-as-git" and "Sync to Git" into one action via the D-03 `GitProvider` adapter, so a document is never left half-converted; sets `sync_status` to `conflict` on a 409 and calls `sdk.connections.markError` on 401/403), `listDocumentRevisions`/`getRevisionContent` (commits filtered by path, content at a SHA) behind a shared `resolveGitContext` helper. `saveDocument` now marks a git-backed document `pending` on every autosave (the remote only updates on an explicit sync). `DocumentPage` gained a sync-status badge, a "Sync to Git" button (shown whenever a drive is connected, regardless of current tier), a "Revisions" `Dialog` (`RevisionsPanel.tsx`), and inline sync-error display. Moved the drive-connect UI off the daily surface into a new `/docs/settings` route (SPEC.md's "setup vs. daily use" — connecting a repo is opt-in, not a first-run gate); the Docs home page now links to Settings instead of showing the form inline. Verified in the browser: the relocated connect form still submits and surfaces GitHub's rejection correctly for a fake token; confirmed Sync/Revisions controls stay hidden with no drive connected in both View and Edit; checked at 375px. The live Sync-to-Git push/commit round-trip against a real GitHub repo was **not** exercised — no GitHub credentials available in this environment — so that path relies on code review plus `git-providers.test.ts`'s existing coverage of the underlying adapter, not a live run. |
| 2026-07-20 | Completed **D-11 viewer + edit-mode toggle + `.md` export**. Renamed `DocumentEditor` to `DocumentPage` and lifted `title`/`content` state up to it so switching View/Edit never loses in-progress edits. Documents now open **read-only by default** (`RichTextEditor` with a new `showToolbar={false}` mode); a "View \| Edit" `SegmentedControl` renders only when the user's `docs_document_members` role permits editing (reuses the existing `getDocumentForEdit` check — no changes needed once D-13 sharing lands). Added a client-side "Download .md" action (`getDocumentForEdit` now also returns `slug` for the filename), available in both modes/tiers per DOCS-11. Verified end-to-end in the browser: View-by-default with hidden toolbar, unsaved edits preserved across a View↔Edit switch, autosave firing, and a clean download — no console/server errors; checked at 375px. |
| 2026-07-20 | Completed **D-10 per-user view preference + WYSIWYG view**. Added a Markdown ⇄ Rich text `SegmentedControl` toggle to `DocumentEditor`, backed by `RichTextEditor.tsx` — Tiptap (`@tiptap/react` + `starter-kit` + `tiptap-markdown`), the same stack `sovereign-plainwrite` already uses for this; StarterKit v3 bundles the full "small feature set" (bold/italic/underline/headings/lists/links/code) with no extra `@tiptap/extension-*` packages. The two views render behind a conditional (never both mounted), so switching into rich text always mounts fresh from the current Markdown string and flows edits back through the existing D-08 autosave path. Added `app/_lib/prefs.ts` (`getDefaultView`/`setDefaultView`) reading/upserting `docs_user_prefs.default_view`; the editor route loads it server-side as the initial view, and the toggle persists a user's choice on every switch. Fixed a token typo found while porting Plainwrite's editor styles (`--sv-color-text-secondary`, which doesn't exist) to the real `--sv-color-text-muted`. Verified end-to-end in the browser: heading/bold parsed correctly into rich text, autosave fired from that view, a full Markdown↔rich-text round-trip left content uncorrupted, and the stored preference correctly reopened the last-selected view on reload. Checked at 375px; no console/server errors. |
| 2026-07-20 | Completed **D-09 Drive-style document list**. Rebuilt the home into a search + Tile-grid surface (`app/_components/DocumentsList.tsx`, `Tile.tsx`): client-side search over projects and root-level documents, an `EmptyState` whose own action creates the first document, and home now lists only root-level documents (`projectId === null`) — project-filed documents live on the new project detail route (`app/projects/[projectId]/page.tsx`, backed by `getProjectOverview`). `CreateDocumentDialog` gained a `fixedProjectId` prop (skips the picker, creates straight into the project) for that route's own create action. No icon added to tiles — `@sovereignfs/ui` has no folder/document glyph yet (ledger precedent: omit rather than misuse). Verified end-to-end in the browser (search match/no-match, project create + navigate + scoped document create + home-list filtering) at 375px and desktop; `pnpm design:tokens:check` passes; no console/server errors. |
| 2026-07-20 | Completed **D-08 Markdown editor + autosave**. Added the editor route (`app/[documentId]/page.tsx`) and `DocumentEditor` (title input + Markdown `Textarea`, 2s-idle-debounced autosave, "Saving…"/"All changes saved"/"Autosave failed" status, `beforeunload` guard) — same debounce pattern as Plainwrite's `saveDraft`. Added `getDocumentForEdit`/`saveDocument` to `app/_lib/documents.ts`, scoped by `docs_document_members` (not `ownerId`) so the route doesn't change when D-13 sharing lands; added the pure `canEditRole` predicate (`app/_lib/document-rules.ts`) it's built on. Document titles in `DocumentsList` now link to `/docs/<id>`. 2 new unit tests (53 total). Verified end-to-end in the browser: typed content, watched the autosave status transition, reloaded and confirmed persistence, confirmed a nonexistent document 404s. No console/server errors. |
| 2026-07-20 | Completed **D-07 create flows + quota gating**. Added `createProject`/`createDocument` server actions (`app/_lib/documents.ts`) with slugify/uniqueSlug/buildGitPath and the pure `resolveDocumentStorage` quota-policy function (`app/_lib/document-rules.ts`); new documents default to `storage: 'local'` with an auto-inserted owner membership row, blocked at `FREE_DOC_LIMIT` with a git-backed-retry or connect-a-drive message depending on drive state. Extracted shared `ActionResult`/`getContext`/`now` into `app/_lib/context.ts` (was duplicated in `actions.ts`). Added `CreateProjectDialog`/`CreateDocumentDialog` and a minimal `DocumentsList` (quota indicator + plain project/document lists — the polished Drive-style layout is D-09's remit), wired into `page.tsx` above the now-secondary drive-connect card. 13 new unit tests (51 total). Verified end-to-end in the browser via `pnpm sv seed` + Console plugin activation: created a project and two documents, quota indicator updated correctly, no console/server errors. |
| 2026-07-20 | Completed **D-06 quota lib**. Added `FREE_DOC_LIMIT` to the manifest `env` field (operator-set, default 25, documented via the schema's `default` field) and `app/_lib/quota.ts`: `parseFreeDocLimit` (pure fallback on unset/non-numeric/non-positive input), `getFreeDocLimit` (`sdk.env.get` in a plugin route context), `canCreateLocalDocument` (pure limit check). Bumped `manifest.json`/`package.json` to `0.2.0` (feat/minor). Validated the manifest against `@sovereignfs/manifest`'s schema. 11 new unit tests (38 total). Typecheck/format/lint clean. |
| 2026-07-20 | Completed **D-05 schema restructure**. `docs_documents` now carries canonical `content` plus the `storage` tier (`local`\|`git`) and git-sync fields (`git_path`/`base_sha`/`sync_status`/`last_synced_at`); dropped the old `status` column and the entire `docs_drafts` table; added `docs_user_prefs` (`default_view`, `markdown`-first). Updated both schema files (`app/_db/schema.ts` + the `db/schema.postgres.ts` mirror) and regenerated fresh `0000` SQLite + Postgres migrations (no shipped data to preserve). Reworked `app/_lib/portability.ts` for the new shape (content travels inline on documents; `docs_drafts` logic removed; git-backed docs import as `local`; user-deletion now clears `docs_user_prefs`) and bumped its export `schemaVersion` to 2; updated the portability tests accordingly. Also renamed `roadmap.md` → `ROADMAP.md` and added an `AGPL-3.0` `LICENSE` (identical to the platform's). Typecheck clean, 27 tests pass, format + lint clean. |
| 2026-07-20 | **Local-first pivot (SPEC v0.3).** Reframed the unbuilt Phase 1 around local-first storage + the `FREE_DOC_LIMIT` quota + a Google-Docs UX and a Markdown-canonical/WYSIWYG editor: new tasks D-05 (schema restructure — content into `docs_documents`, `storage` tier, drop `docs_drafts`, add `docs_user_prefs`), D-06 (quota lib + manifest `env`), D-07 (create + quota gating), D-08 (editor + autosave), D-09 (Drive-style list), D-10 (view pref + WYSIWYG, absorbing the old rich-text task), D-11 (viewer + `.md` export), D-12 (opt-in git tier: Sync to Git + revisions, demoting D-04's drive-connect from a gate), D-13 (sharing), D-14 (portability), D-15 (hardening). Renumbered later tasks: platform RFC 0042 D-14→D-16, public sharing D-15→D-17, GitHub OAuth D-16→D-18; assets/perf/conflict keep D-19/D-20/D-21; added D-26 (local version history). D-02…D-04 remain ✅ (D-04 demoted to the opt-in tier). |
| 2026-07-17 | Completed D-04 drive config UI + server actions (`app/_lib/actions.ts`, `ConnectDriveForm`/`DriveStatusCard`). PAT-only, stores token via `sdk.secrets`, `sdk.connections` record, `docs/.gitkeep` on connect. Extracted `parseRepository`/`sanitizeError` into `drive-rules.ts`. Not verified live in the browser (a concurrent session on the shared checkout wiped the working tree mid-task; recovered by re-cloning). |
| 2026-07-16 | Completed D-03 git provider adapter (`app/_lib/git-providers.ts`), ported from `sovereign-plainwrite`. Added `listCommits()` + optional `ref` on `getFileContent()`. 16 unit tests. |
| 2026-07-16 | Completed D-02 DB schema (`docs_drives`/`docs_projects`/`docs_documents`/`docs_drafts`/`docs_document_members`), SQLite + Postgres migrations, dual-schema mirror. |
| 2026-07-16 | Completed D-00 bootstrap: `package.json`, `tsconfig.json`, `manifest.json` (`shell: default`), placeholder page/layout, README. |
| 2026-07-16 | Re-verified platform readiness against `claude-sv` code. Retired Phase 4/D-18 (`sdk.storage` already implemented). Found `sdk.connections`/`sdk.e2ee` implemented. |
| 2026-07-12 | Initial roadmap, derived from SPEC.md build plan + platform audit. |
