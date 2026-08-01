# Sovereign Docs

**Version:** 0.3\
**Date:** 20 Jul 2026\
**Author:** kasunben\
**Purpose:** Canonical specification for the Sovereign Docs plugin — the single source of truth for its manifest, access model, storage tiers, data model, and build plan.\
**Status:** Draft

---

Sovereign Docs is a **privacy-first document workspace** — a clean, Google-Docs-style
place to write and organise documents. Documents are **Markdown under the hood**
(own-your-data: exportable as plain `.md` any time) but edited through a familiar
rich-text/WYSIWYG surface. Content lives on the platform by default; connecting a
**git repository ("Sovereign Drive") is an opt-in, secondary feature** that unlocks
unlimited documents and a real, browsable Markdown tree with commit history.

**Design principles:** own your data (every document is Markdown, exportable as a
plain file, and — once you opt into git — a real file in your own repo),
minimalism (a clean editor that gets out of the way, Google Docs as the UX north
star), and reliability (documents autosave to the platform and are never lost).

The plugin is `type: sovereign` — maintained in a separate external repository.

## What changed in v0.3 (the local-first pivot)

Earlier drafts (v0.1/v0.2) made git **mandatory and primary**: you could not
create a document without first connecting a repo, and a document's canonical copy
lived in git after an explicit **Publish**. v0.3 inverts this:

- **The platform database is the canonical store.** Every document's Markdown lives
  in the plugin DB and **autosaves** as you type (no explicit Save button, Google
  Docs–style).
- **Git is secondary and opt-in.** A user can create up to an **operator-set number
  of local documents** with no git at all. To go beyond that limit they connect a
  Sovereign Drive; documents created after that are **git-backed** and unlimited.
- **"Publish" becomes "Sync to Git"** and exists only for git-backed documents.
- **The editor is Markdown-canonical with a WYSIWYG view**, and each user chooses
  their **default view** (Markdown or WYSIWYG) as a stored preference.

This pivot was made while the product surface (create/editor/index/sharing) was
still unbuilt — only the DB schema, git provider adapter, and drive-connect flow
existed — so it is largely a re-specification, not a teardown. The git provider
adapter (`app/_lib/git-providers.ts`) and the drive-connect flow
(`app/_lib/actions.ts`, `ConnectDriveForm`, `DriveStatusCard`) are **kept** and
demoted from "gate" to "opt-in tier".

## Platform surfaces relied on (verified against `claude-sv`, 2026-07-16/20)

The authoritative signal for what the platform provides is the ✅ column in
`claude-sv`'s `docs/roadmap.md`, **not** RFC frontmatter (which lags reality).
Re-verify (roadmap task D-01) before Phase 2/3 work.

Implemented and used by Docs:

- **`sdk.env` (RFC 0018)** — plugin-scoped env vars, read via `sdk.env.get(KEY)`
  (resolves `SV_PLUGIN_FS_SOVEREIGN_DOCS_<KEY>`). **This is the operator-config
  mechanism for the document quota** — see [Document quota](#document-quota).
- `sdk.secrets` (RFC 0043) — per-secret vault; stores the per-user git PAT.
- `sdk.connections` (RFC 0049) — external-connection metadata/lifecycle; backs the
  opt-in git drive.
- `sdk.directory` (RFC 0041) — user picker for instance sharing.
- `sdk.storage` (RFC 0044) — file storage; reserved for **images/attachments**
  (post-v1, D-19), **not** document bodies (see
  [Storage tiers](#storage-tiers-local-first-git-optional) for why bodies stay in
  the DB).
- `sdk.notifications`, `sdk.data`, `sdk.mailer` — share alerts, read-only data
  contracts, share emails.

Still genuinely absent (confirmed no code):

- Public plugin page routes (RFC 0042) — no middleware exemption from the session
  gate. Public document sharing (D-17) is blocked on this.
- Plugin tool contracts (RFC 0047) — no `sdk.tools`. Assistant/automation writes
  wait for this.

## Contents

- [Identity and manifest](#identity-and-manifest)
- [Storage tiers: local-first, git-optional](#storage-tiers-local-first-git-optional)
- [Document quota](#document-quota)
- [Access control](#access-control)
- [Functional requirements](#functional-requirements)
- [Editor and UI (Google Docs as reference)](#editor-and-ui-google-docs-as-reference)
- [Git layer (opt-in tier)](#git-layer-opt-in-tier)
- [Public sharing](#public-sharing)
- [Data model](#data-model)
- [SDK dependencies](#sdk-dependencies)
- [Portability and deletion](#portability-and-deletion)
- [Build plan](#build-plan)
- [Open questions](#open-questions)
- [Changelog](#changelog)

---

## Identity and manifest

| Property                           | Value                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                               | `fs.sovereign.docs`                                                                    |
| `name`                             | `Docs`                                                                                 |
| `type`                             | `sovereign`                                                                            |
| `runtime`                          | `native`                                                                               |
| `routePrefix`                      | `/docs`                                                                                |
| `shell`                            | `default` (editor view collapses the chrome — consistent with sibling `type: sovereign` plugins) |
| `adminOnly`                        | omitted (`false`)                                                                      |
| `icon`                             | `icon.svg`                                                                             |
| `permissions`                      | `auth:session`, `db:readWrite`, `mailer:send`, `notifications:send`, `data:provide`, `data:export`, `data:import` |
| `env`                              | `FREE_DOC_LIMIT` (see [Document quota](#document-quota))                                |
| `connections`                      | `github` provider (only needed once OAuth lands — D-18)                                 |
| `repository`                       | `https://github.com/sovereignfs/sovereign-plugin-docs`                                        |
| `compatibility.minPlatformVersion` | `0.19.0`; public document routes additionally need RFC 0042, not yet landed             |

Manifest additions for v0.3 (added by the quota task, D-06):

```json
{
  "env": {
    "FREE_DOC_LIMIT": {
      "description": "Maximum number of local (non-git) documents a user may create before a Sovereign Drive (git repo) must be connected. Integer > 0. Defaults to 25 when unset or invalid.",
      "secret": false,
      "scope": "runtime",
      "required": false
    }
  }
}
```

The `connections.providers` block (GitHub OAuth) is only added when the **OAuth**
drive flow lands (D-18). The v0.1 **PAT** flow already works without it (it creates
an `sdk.connections` record with no OAuth state). `sdk.env`, `sdk.connections`, and
`sdk.secrets` are **not** manifest `permissions` enum entries — they gate on plugin
route context (plus, for connections, the `connections` declaration).

**Storage permission.** `storage:readWrite` is **not** in the v0.1 manifest —
document bodies live in the DB, not `sdk.storage`. It is added later, in D-19, when
images/attachments are introduced.

## Storage tiers: local-first, git-optional

There are two storage tiers for a document. Both store the **canonical Markdown in
the plugin database**; they differ in whether that Markdown is also mirrored to a
git repository.

| Tier | Canonical content | Requires a drive? | Counts against quota? | Revisions | "It's just Markdown files" |
| --- | --- | --- | --- | --- | --- |
| **Local** (default, free) | Plugin DB (`docs_documents.content`) | No | **Yes** | `updated_at` (v1); full history later | Export/download `.md` any time |
| **Git-backed** (opt-in) | Plugin DB, synced to git on demand | Yes | No | Git commit history | ✅ real, browsable `.md` tree in your repo |

**Why document bodies live in the DB, not `sdk.storage`.** `sdk.storage` (RFC 0044)
does write real files to disk, but under **server-generated opaque object IDs**, not
a human-navigable `docs/<project>/<slug>.md` tree — so it would not deliver the
"browse your Markdown" experience that only git provides, while costing more:
Google-Docs-style **autosave** produces many small writes (DB rows handle this far
better than rewriting storage objects and re-accounting storage quota each time),
**search** over document text is trivial in SQL but lost against opaque blobs, and
**export** already serializes DB rows. So: local bodies stay in the DB, git delivers
the browsable file tree, and `sdk.storage` is reserved for images/attachments (D-19).

**Direct filesystem writes are prohibited.** A plugin must never `fs.writeFile` its
own tree — it bypasses tenant/user scoping, storage quotas, path-traversal
protection, export/import, and the Docker named-volume assumptions
(`findWorkspaceRoot()`), which is a platform data-loss hard rule. File storage is
always `sdk.storage`; the browsable Markdown tree is always git.

## Document quota

The free local tier is bounded by an **operator-set limit**, `FREE_DOC_LIMIT`.

- **Mechanism:** the manifest `env` field above; read at runtime with
  `sdk.env.get('FREE_DOC_LIMIT')`, which resolves the operator-set
  `SV_PLUGIN_FS_SOVEREIGN_DOCS_FREE_DOC_LIMIT` environment variable.
- **Parsing:** parse as an integer. If unset, non-numeric, or `<= 0`, fall back to
  the default **25**. This lives in a small pure helper (`app/_lib/quota.ts`) so it
  is unit-tested independently of any request.
- **What it counts:** the number of the current user's **db** documents —
  `docs_documents WHERE owner_id = <me> AND storage = 'db'` (tenant-scoped).
  Git-backed documents do **not** count and are unlimited.
- **Enforcement:** at **create time**. If the user has no drive connected and is at
  the limit, block creation with a Google-Docs-style dialog:
  _"You've reached your N free documents. Connect a Git repository to create more,"_
  linking to the drive-connect flow. If a drive **is** connected, the create action
  offers to create the document as **git-backed** (which doesn't count) instead of
  blocking.
- **Display:** the document list shows a quota indicator (e.g. "18 of 25
  documents") while under the local tier; it disappears / becomes "Unlimited (Git
  connected)" once a drive is connected.

Operator note: because `FREE_DOC_LIMIT` is a plugin-scoped env var, it is set at
deploy time in the instance environment. A runtime, Console-managed override is a
possible future enhancement (see [Open questions](#open-questions)) but is out of
scope for v1.

## Access control

- **Private by default.** A document is visible only to its owner until shared.
- **Instance sharing.** The owner shares a document with other users on the same
  instance via a members table — roles `owner` / `editor` / `viewer`.
- **Public sharing.** The owner can make a document publicly viewable via a
  **public-share token** (expiring by default; permanent on explicit opt-in) —
  gated on RFC 0042 (D-16/D-17).
- The plugin's authenticated routes inherit the platform session gate (PLT-02/03);
  the **public document route is the one exception** and does its own auth (token or
  session).

## Functional requirements

| ID      | Requirement                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCS-01 | On first use the user lands directly in a **document workspace** — no setup required. They can create and edit documents immediately, with content stored locally on the platform. |
| DOCS-02 | The user can create **document projects** (folders) and **individual documents**. _Create project_ prompts for a name; _create document_ opens the editor on a blank document.   |
| DOCS-03 | Documents **autosave** continuously to the platform DB (no explicit Save). An autosave indicator communicates state ("Saving…", "All changes saved").                            |
| DOCS-04 | The **editor** is **Markdown-canonical** with a **WYSIWYG view** over the same Markdown. Each user sets their **default view** (Markdown / WYSIWYG) as a stored preference.       |
| DOCS-05 | A user may create up to **`FREE_DOC_LIMIT`** local documents (operator-set, default 25). At the limit, creating more requires connecting a **Sovereign Drive** (git repo).       |
| DOCS-06 | Connecting a drive is an **opt-in, secondary** action from settings (or prompted at the quota limit). Documents created with a drive connected may be **git-backed**.           |
| DOCS-07 | For a **git-backed** document, **Sync to Git** pushes its Markdown to the configured repository; **revisions** come from git commit history (commits filtered to the file path). |
| DOCS-08 | The **document list** (home) shows all projects and documents owned by (or shared with) the user, with search, in a clean Google-Docs/Drive-style layout, plus a quota indicator. |
| DOCS-09 | Opening a document opens a **viewer** (read-only render) with a toggle to **edit mode** (permission-gated).                                                                      |
| DOCS-10 | The user can **share** a document with other instance users (roles owner/editor/viewer).                                                                                         |
| DOCS-11 | A document can be **exported/downloaded as a plain `.md` file** at any time, regardless of tier.                                                                                  |
| DOCS-12 | A document can be made **public** via a public link — expiring by default, permanent only when explicitly set (gated on RFC 0042).                                               |

## Editor and UI (Google Docs as reference)

The UX north star is **Google Docs / Drive**. Everything is built on `packages/ui`
tokens and components (no Tailwind, no runtime CSS-in-JS), following the
`sv-ui-design` workflow (wireframe-first). "App" is the user-facing term; "plugin"
never appears in end-user copy.

- **Home / document list (Drive-style).** A grid or list of documents and projects
  owned by / shared with the user; a prominent **"＋ Blank"** create action; project
  (folder) navigation; **search**; the quota indicator. Empty state invites creating
  the first document.
- **Editor (Docs-style).** Full-bleed document page on a neutral canvas; a top bar
  with the **inline-editable title** and a menu; a **formatting toolbar**; an
  **autosave indicator**; a **Markdown ⇄ WYSIWYG view toggle**; a **Share** button;
  and, for git-backed documents, a **Sync to Git** action and a **revisions** panel.
  The shell chrome collapses in the editor (layout/CSS), matching sibling plugins.
- **View preference.** The Markdown/WYSIWYG toggle reflects and updates the user's
  stored `default_view`; opening any document honours that default.
- **Viewer.** Clean read-only render with an **edit toggle** when permitted; reused
  by the public route later.

**Editor scope (v1 — "start small").** Markdown is the stored format. The WYSIWYG
view is a rich surface over it covering the common set: bold, italic, underline,
headings, ordered/unordered lists, links, and code. Round-trip fidelity
(frontmatter, code blocks, tables) is an explicit concern — see
[Open questions](#open-questions). Comments, suggestions, real-time collaboration,
and page layout are **out of scope for v1** (we start small, dream big).

Net-new UI primitives (not in `@sovereignfs/ui` today): the Markdown/WYSIWYG editor
and the git revision view. Reusable pieces should be built in `packages/ui` or the
shell per the DS-first rule, not plugin-locally — though the editor may begin
plugin-local and be promoted once its shape stabilises.

## Git layer (opt-in tier)

Unchanged in mechanism from earlier drafts, only demoted from "gate" to "opt-in":

**Git via REST, no git binary.** All repo operations go through **provider REST
APIs** (the standalone image ships no `git` binary): list/read via the Contents /
Git trees API; **Sync** a single file via the Contents API (atomic multi-file via
the Git Data API); **revisions** via the commits API filtered by path; **conflict
detection** via a stored `base_sha` per document.

**Provider adapter.** `GitProvider` interface + `GitHubProvider` implementation
(`app/_lib/git-providers.ts`), already built (D-03). Takes an already-resolved
access token — the OAuth handshake (D-18) is `sdk.connections`' job, not the
adapter's.

**Credentials & connection lifecycle — via `sdk.connections` + `sdk.secrets`.**
Unchanged and already built (D-04): the PAT is stored in the `sdk.secrets` vault;
an `sdk.connections` record (provider `github`, `secretRef`, `metadata.repoOwner`/
`repoName`/`login`) is the source of truth for connection status; `docs_drives`
keeps only `connection_id` + `branch`/`base_path`. On API failure call
`sdk.connections.markError(...)` with a sanitized message; disconnect calls
`sdk.connections.disconnect()`.

**Sync lifecycle (git-backed docs).**

```
edit → autosave  → docs_documents.content updated (DB; never lost)
     → Sync to Git → push content to repo; store base_sha; sync_status = synced
```

Local documents have no Sync step. Document-content E2EE remains post-v1 (D-23).

## Public sharing

Public access needs the RFC 0042 primitive (a plugin-declared public page prefix
exempt from the global session gate, with plugin-owned token-or-session auth). Until
that lands (platform task D-16), public sharing falls back to "the git-backed
document's file is public on GitHub" (link out). Target design (D-17):

- A `docs_public_shares` token registry maps a token → document, with a `mode`
  (`expiring` | `permanent`) and `expires_at`.
- A public document route (e.g. `/docs/p/<token>`) serves a read-only HTML render,
  doing its own auth: render publicly if a valid token resolves, else require a
  session, else 404.
- **Expiry-first:** default to an expiring link (a TTL sweep cleans them up);
  permanent must be set explicitly and may be cached.

## Data model

All tables are `docs_`-prefixed and carry `tenant_id` (platform rule). The v0.3
schema restructure (roadmap task D-05) folds document content into
`docs_documents`, adds the `storage` tier and git-sync fields, **drops
`docs_drafts`** (the per-`(document_id, user_id)` draft table was built for the old
draft→publish model and implies per-user collaboration that is post-v1), and adds
`docs_user_prefs`.

| Table                   | Key columns                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs_documents`        | `id`, `tenant_id`, `owner_id`, `project_id?`, `title`, `slug`, **`content`** (canonical Markdown), **`storage`** (`db`\|`git`), `git_path?`, `base_sha?`, `sync_status?` (`synced`\|`pending`\|`conflict`), `last_synced_at?`, `created_at`, `updated_at` |
| `docs_projects`         | `id`, `tenant_id`, `owner_id`, `name`, `slug`, `created_at`                                                                                                                        |
| `docs_user_prefs`       | `user_id` (PK), `tenant_id`, `default_view` (`markdown`\|`wysiwyg`), `created_at`, `updated_at`                                                                                    |
| `docs_drives`           | `user_id` (PK, one repo/user), `tenant_id`, `connection_id` (→ `sdk.connections`), `branch`, `base_path` (`docs`), `created_at` — **optional now; only exists for git-backed docs** |
| `docs_document_members` | (`document_id`, `user_id`) PK, `tenant_id`, `role` (`owner`\|`editor`\|`viewer`), `invited_by?`, `joined_at`                                                                       |
| `docs_public_shares`    | `id`, `tenant_id`, `document_id`, `token` (unique), `mode` (`expiring`\|`permanent`), `expires_at?`, `created_by`, `created_at` — v0.2 (D-17)                                       |

**Removed:** `docs_drafts` (content moved into `docs_documents.content`; autosave
writes the document row directly). No shipped data exists to migrate — regenerate
the SQLite + Postgres migrations fresh (dual-schema convention).

## SDK dependencies

| SDK surface         | Used for                                           | Status                            |
| ------------------- | -------------------------------------------------- | --------------------------------- |
| `sdk.auth`          | Current user session                               | Stable                            |
| `sdk.db`            | `docs_*` tables (content, metadata, prefs, shares) | Stable                            |
| `sdk.env`           | **Operator-set `FREE_DOC_LIMIT` quota**            | Implemented (RFC 0018)            |
| `sdk.directory`     | Share target picker                                | Implemented (RFC 0041)            |
| `sdk.mailer`        | Share notification emails                          | Stable                            |
| `sdk.notifications` | In-app/push share alerts                           | Implemented                       |
| `sdk.data`          | Read-only document/snippet contracts               | Implemented                       |
| `sdk.secrets`       | Per-user git token storage (opt-in tier)           | Implemented (RFC 0043)            |
| `sdk.connections`   | Git connection metadata/lifecycle (opt-in tier)    | Implemented (RFC 0049)            |
| `sdk.storage`       | Images/attachments (post-v1, D-19) — **not bodies**| Implemented (RFC 0044)            |
| `sdk.tools`         | Future confirmed create/publish actions            | Not implemented (RFC 0047)        |

### Data contracts

Candidate read-only contracts: `docs.documents` (v1), `docs.snippets` (v1),
`docs.revisions` (v1).

## Portability and deletion

Export includes document metadata **and content** (Markdown, since bodies are now
canonical in the DB), projects, user view preferences, shares, public-share
records, and connection metadata. Git credentials are never exported. Import
restores documents/metadata additively; remote git contents are not recreated
unless the user reconnects a drive. User deletion removes the user's documents and
prefs, disconnects the `sdk.connections` record (removing the linked `sdk.secrets`
entry), revokes public shares created by the user, and transfers/archives shared
documents per membership.

## Build plan

- **v0.1 (local-first core)** — schema restructure; the quota; create project/
  document with quota gating; the Markdown editor + autosave; the Drive-style
  document list with search; per-user view preference + WYSIWYG view; viewer +
  edit toggle; the **opt-in git-backed tier** (Sync to Git + git revisions,
  reusing the existing adapter/drive-connect flow); instance sharing; `.md` export;
  portability + deletion; a hardening pass.
- **v0.2** — GitHub **OAuth** drive connection (alongside PAT); **public sharing**
  via the token registry (expiring links) — gated on the RFC 0042 platform
  primitive.
- **v0.3** — images/assets via `sdk.storage`; permanent public docs + caching;
  external-edit conflict resolution UI.
- **v1.0** — stable.
- **Post-v1** — multiple repos; document-content E2EE (`sdk.e2ee`, RFC 0060);
  GitLab/Gitea providers; assistant tool contracts (`sdk.tools`, RFC 0047).

Full task sequence and status: [ROADMAP.md](ROADMAP.md).

## Open questions

1. **Markdown ↔ WYSIWYG fidelity.** Round-tripping without mangling raw Markdown
   (frontmatter, code blocks, tables) — the core editor risk.
2. **Local revision history.** v1 gives local docs only `updated_at`. Do we want a
   lightweight local version history (periodic snapshots in the DB) before/without
   git? (Google Docs has rich version history; git delivers it only for the git
   tier.)
3. **Runtime, Console-managed `FREE_DOC_LIMIT` override.** Env var is deploy-time;
   a Console admin UI (like Console-managed SMTP) would let operators change it live.
   Out of scope for v1 — worth revisiting.
4. **Quota semantics on drive connect.** Confirmed: the quota only ever caps
   **local** documents; connecting a drive lifts nothing retroactively but makes new
   **git-backed** documents unlimited. (Resolved for v1.)
5. **Migrating a local doc to git-backed** (and back). What's the UX and what
   happens to history? Likely v0.2+.
6. **Public-page platform primitive.** Public routes depend on RFC 0042 (Draft, no
   code). Until then, public = public GitHub repo (git tier only).
7. **Image/asset storage & path resolution** (D-19) — `sdk.storage` object keys vs
   relative paths in Markdown, in both editor and public render.
8. **Shared git layer.** Extracting the `GitProvider` REST adapter into a package
   shared with Plainwrite — only after both stabilise.

## Changelog

| Version | Date         | Change                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.3     | 20 Jul 2026  | **Local-first pivot.** Git demoted from mandatory/primary to opt-in/secondary. Platform DB is now the canonical store; documents **autosave** (no explicit Save/Publish for local docs). Introduced two **storage tiers** (local / git-backed) and an operator-set **`FREE_DOC_LIMIT`** quota via `sdk.env` (RFC 0018), counting local docs only. Editor re-specced as **Markdown-canonical with a WYSIWYG view** + per-user **default-view** preference. UX north star set to **Google Docs / Drive**. Data model: content folded into `docs_documents` (+ `storage`/git-sync fields), **`docs_drafts` dropped**, `docs_user_prefs` added; regenerate migrations. Documented why bodies stay in the DB (not `sdk.storage`) and that direct `fs` writes are prohibited. FRs rewritten (DOCS-01…12); build plan/roadmap reframed. `storage:readWrite` deferred to D-19. |
| 0.2     | 16 Jul 2026  | Re-verified against `claude-sv` code. Replaced plugin-local credential encryption with `sdk.connections` (RFC 0049) + `sdk.secrets` (RFC 0043); dropped `docs_credentials`, slimmed `docs_drives`. Corrected `sdk.storage` from "stub" to implemented. Settled on `shell: default`. Fixed `minPlatformVersion` (0.19.0). Added `data:export`/`data:import` permissions. |
| 0.1     | Jun 2026     | Initial proposal (git-backed, git-mandatory).                                                                                                                                                                                                                                                                                                     |
