import { sdk } from '@sovereignfs/sdk';

/**
 * Operator-configurable cap on db-only (non-git) documents per user (SPEC.md
 * "Document quota"). Set via the manifest `env.FREE_DOC_LIMIT` declaration,
 * resolved at runtime from `SV_PLUGIN_FS_SOVEREIGN_DOCS_FREE_DOC_LIMIT`.
 * Git-backed documents never count against this limit.
 */
export const DEFAULT_FREE_DOC_LIMIT = 25;

/**
 * Parses the raw `FREE_DOC_LIMIT` env value into a usable limit. Pure and
 * request-independent so it's unit-testable without a plugin route context.
 * Falls back to `DEFAULT_FREE_DOC_LIMIT` when the input is missing,
 * non-numeric, non-integer, or not greater than zero.
 */
export function parseFreeDocLimit(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_FREE_DOC_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_FREE_DOC_LIMIT;
  return parsed;
}

/** Reads the operator's configured db-document limit for the current plugin route context. */
export async function getFreeDocLimit(): Promise<number> {
  const raw = await sdk.env.get('FREE_DOC_LIMIT');
  return parseFreeDocLimit(raw);
}

/**
 * Whether a user with `dbDocumentCount` existing db-only documents may
 * create one more, given `limit`. Pure — callers supply the count (from
 * `docs_documents WHERE owner_id = ? AND storage = 'db'`) and the limit
 * (from `getFreeDocLimit()`).
 */
export function canCreateDbDocument(dbDocumentCount: number, limit: number): boolean {
  return dbDocumentCount < limit;
}
