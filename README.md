# Sovereign Docs

Sovereign Docs is a Sovereign plugin for writing and organizing documents — a
clean, Google-Docs-style, **privacy-first document workspace**: your documents
live in the platform's own database and work with no external setup. Documents
are **Markdown under the hood** (exportable as plain `.md` any time), edited
through a Markdown or WYSIWYG view.

Connecting a **git repository ("Sovereign Drive") is an opt-in, secondary feature**
that unlocks unlimited documents and a real, browsable Markdown tree with commit
history.

Full specification: [SPEC.md](SPEC.md). Build sequence and status:
[ROADMAP.md](ROADMAP.md).

## Storage tiers

- **Database (default, free)** — content is stored in the plugin's database as
  canonical Markdown, autosaved as you type. Bounded by an operator-set document
  limit (see below). Export any document as a `.md` file at any time.
- **Git-backed (opt-in)** — connect a GitHub repository; documents can then be
  synced to git, giving unlimited documents, a browsable `docs/` Markdown tree in
  your own repo, and commit-history revisions.

## Current scope

Built so far (roadmap D-00–D-04): repo bootstrap, DB schema, the GitHub provider
adapter, and the drive-connect flow. The core product surface — create,
editor + autosave, document list, WYSIWYG view, the quota, the opt-in git tier, and
sharing — is roadmap tasks **D-05 onward** and not yet built. See
[ROADMAP.md](ROADMAP.md).

## Local development

Copy this checkout into a platform workspace as a local plugin checkout:

```
plugins/sovereign-docs.local
```

Then run the platform generate/dev workflow from the platform repository:

```bash
pnpm generate
pnpm dev
```

The app is served at `/docs` once composed by the platform.

## Operator configuration

### `SV_PLUGIN_FS_SOVEREIGN_DOCS_FREE_DOC_LIMIT` (document quota)

The number of **db (non-git) documents** a user may create before they must
connect a Sovereign Drive (git repository) to create more. Read via the plugin-
scoped env mechanism (`sdk.env`, RFC 0018). Integer greater than 0; defaults to
**25** when unset or invalid. Git-backed documents do not count against this limit
and are unlimited.

```bash
# Instance environment (deploy time)
SV_PLUGIN_FS_SOVEREIGN_DOCS_FREE_DOC_LIMIT=50
```

### `SOVEREIGN_VAULT_KEY` (only for the opt-in git tier)

Connecting a GitHub drive stores the credential through the platform's plugin secret
vault (`sdk.secrets`), which requires the operator to set **`SOVEREIGN_VAULT_KEY`**
(a 32-byte key, `openssl rand -base64 32`) in the instance environment. This is only
needed once a user connects a drive — the db tier works without it. See the
platform's `docs/self-hosting.md` for the full variable reference.
