'use server';

import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import type { NotificationListResult } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { docsDrives } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { DEFAULT_BASE_PATH, parseRepository, sanitizeError } from './drive-rules';
import {
  detectGitHubRepository,
  getGitProvider,
  GitProviderError,
  type GitRepoRef,
} from './git-providers';

export type { ActionResult };

export interface DriveView {
  connectionId: string;
  branch: string;
  basePath: string;
  repoOwner: string;
  repoName: string;
  status: 'connected' | 'needs_reauth' | 'paused' | 'error' | 'disconnected';
  login: string | null;
  lastError: string | null;
}

/** Reads the current user's drive + its live connection status, or null if none exists. */
export async function getDrive(): Promise<DriveView | null> {
  const { db, userId, tenantId } = await getContext();
  const [drive] = await db
    .select()
    .from(docsDrives)
    .where(and(eq(docsDrives.tenantId, tenantId), eq(docsDrives.userId, userId)))
    .limit(1);
  if (!drive) return null;

  const connection = await sdk.connections.get(drive.connectionId);
  if (!connection || connection.status === 'disconnected') return null;

  const metadata = connection.metadata ?? {};
  return {
    connectionId: drive.connectionId,
    branch: drive.branch,
    basePath: drive.basePath,
    repoOwner: typeof metadata.repoOwner === 'string' ? metadata.repoOwner : '',
    repoName: typeof metadata.repoName === 'string' ? metadata.repoName : '',
    status: connection.status,
    login: typeof metadata.login === 'string' ? metadata.login : null,
    lastError: connection.lastError?.message ?? null,
  };
}

export async function connectDrive(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const repository = String(formData.get('repository') ?? '').trim();
  const branchInput = String(formData.get('branch') ?? '').trim();
  const token = String(formData.get('token') ?? '').trim();

  const parsed = parseRepository(repository);
  if (!parsed) return { ok: false, error: 'Enter a repository as owner/repo-name.' };
  if (!token) return { ok: false, error: 'Enter a personal access token.' };

  let branch = branchInput;
  if (!branch) {
    try {
      const detected = await detectGitHubRepository(parsed.owner, parsed.repo, token);
      if (!detected) {
        return {
          ok: false,
          error: "Couldn't find that repository, or the token can't access it.",
        };
      }
      branch = detected.defaultBranch;
    } catch (error) {
      return { ok: false, error: sanitizeError(error) };
    }
  }

  const repo: GitRepoRef = { owner: parsed.owner, repo: parsed.repo, branch };
  const provider = getGitProvider('github');

  let login: string;
  try {
    const userInfo = await provider.validatePat(token, repo);
    if (!userInfo.canPush) {
      return {
        ok: false,
        error: "This token can't write to that repository. Use a token with contents write access.",
      };
    }
    login = userInfo.login;
  } catch (error) {
    return { ok: false, error: sanitizeError(error) };
  }

  const [existing] = await db
    .select()
    .from(docsDrives)
    .where(and(eq(docsDrives.tenantId, tenantId), eq(docsDrives.userId, userId)))
    .limit(1);

  const secretLabel = `Docs GitHub token for ${parsed.owner}/${parsed.repo}`;
  const secret = await sdk.secrets.create({
    scope: 'user',
    label: secretLabel,
    value: token,
    metadata: { provider: 'github', repo: `${parsed.owner}/${parsed.repo}` },
  });

  const connectionMetadata = {
    repoOwner: parsed.owner,
    repoName: parsed.repo,
    login,
  };

  let connectionId: string;
  if (existing) {
    const connection = await sdk.connections.update(existing.connectionId, {
      label: secretLabel,
      status: 'connected',
      secretRef: secret.id,
      metadata: connectionMetadata,
      lastCheckedAt: now(),
    });
    connectionId = connection.id;
  } else {
    const connection = await sdk.connections.create({
      scope: 'user',
      provider: 'github',
      label: secretLabel,
      secretRef: secret.id,
      metadata: connectionMetadata,
    });
    connectionId = connection.id;
  }

  const ts = now();
  if (existing) {
    await db
      .update(docsDrives)
      .set({ connectionId, branch, basePath: DEFAULT_BASE_PATH })
      .where(and(eq(docsDrives.tenantId, tenantId), eq(docsDrives.userId, userId)));
  } else {
    await db.insert(docsDrives).values({
      userId,
      tenantId,
      connectionId,
      branch,
      basePath: DEFAULT_BASE_PATH,
      createdAt: ts,
    });
  }

  // Ensure the documents directory exists in the repo so it's visible on
  // GitHub immediately, rather than only appearing once the first document
  // is published. Idempotent: skip if a placeholder (or any prior document)
  // is already there.
  try {
    await provider.getFileContent(repo, `${DEFAULT_BASE_PATH}/.gitkeep`, { token });
  } catch (error) {
    if (error instanceof GitProviderError && error.notFound) {
      await provider.publishFile(
        repo,
        {
          path: `${DEFAULT_BASE_PATH}/.gitkeep`,
          content: '',
          baseSha: null,
          message: 'Initialize Sovereign Docs directory',
        },
        { token },
      );
    }
  }

  revalidatePath('/');
  return { ok: true };
}

export async function disconnectDrive(
  _prevState: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  const [drive] = await db
    .select()
    .from(docsDrives)
    .where(and(eq(docsDrives.tenantId, tenantId), eq(docsDrives.userId, userId)))
    .limit(1);
  if (!drive) return { ok: true };

  await sdk.connections.disconnect(drive.connectionId);
  await db
    .delete(docsDrives)
    .where(and(eq(docsDrives.tenantId, tenantId), eq(docsDrives.userId, userId)));

  revalidatePath('/');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Platform notifications — thin wrappers over `@sovereignfs/sdk`'s
// `notifications` namespace, consumed by `DocsNotificationBell` (the
// self-rendered header's bell under `shell: minimal`, mirroring Kanban's own
// `KanbanNotificationBell`/`listPlatformNotifications` et al.). The session
// check is what makes these safe to expose as server actions — not the
// (nonexistent) route-level gating an action id gets none of.

export async function listPlatformNotifications(): Promise<NotificationListResult> {
  await sdk.auth.requireSession();
  return sdk.notifications.list();
}

export async function markPlatformNotificationRead(id: string): Promise<ActionResult> {
  await sdk.auth.requireSession();
  await sdk.notifications.markRead(id);
  return { ok: true, message: 'Marked read.' };
}

export async function markAllPlatformNotificationsRead(): Promise<ActionResult> {
  await sdk.auth.requireSession();
  await sdk.notifications.markAllRead();
  return { ok: true, message: 'Marked all read.' };
}

export async function dismissPlatformNotification(id: string): Promise<ActionResult> {
  await sdk.auth.requireSession();
  await sdk.notifications.dismiss(id);
  return { ok: true, message: 'Dismissed.' };
}

export async function dismissAllPlatformNotifications(): Promise<ActionResult> {
  await sdk.auth.requireSession();
  await sdk.notifications.dismissAll();
  return { ok: true, message: 'Cleared.' };
}
