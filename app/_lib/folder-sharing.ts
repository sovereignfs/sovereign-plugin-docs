'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { docsFolderMembers, docsFolders } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { type FolderMemberRole, isFolderMemberRole } from './folder-rules';

/**
 * Best-effort in-app alert for a new share — a failure here (the
 * notification center being briefly unavailable) must never block an invite
 * that already succeeded. Same reasoning applies to `emailMember` below.
 * Ported from `sharing.ts`'s document-level equivalent.
 */
async function notifyMember(
  recipientUserId: string,
  folderName: string,
  folderId: string,
  role: FolderMemberRole,
) {
  try {
    await sdk.notifications.send(
      {
        recipientUserId,
        title: 'Shared a folder with you',
        body: `You were added to "${folderName}" as ${role}.`,
        url: `/docs/f/${folderId}`,
      },
      await headers(),
    );
  } catch {
    // See docblock above.
  }
}

async function emailMember(email: string, folderName: string, folderId: string) {
  try {
    await sdk.mailer.send({
      to: email,
      subject: `You've been added to "${folderName}"`,
      text: `You now have access to "${folderName}" in Sovereign Docs.\n\nOpen it: /docs/f/${folderId}`,
    });
  } catch {
    // See notifyMember's docblock.
  }
}

/**
 * Only a folder's owner manages sharing (invite/remove/role-change) or
 * sees the member list — same gating `sharing.ts`'s `requireOwner` applies
 * to documents. A folder role does grant document access (the "shared
 * folder" model, see `documents.ts`'s `resolveDocumentRole`), but does
 * **not** extend to managing the folder's own sharing.
 */
async function requireOwner(folderId: string) {
  const { db, userId, tenantId } = await getContext();
  const [membership] = await db
    .select({ role: docsFolderMembers.role })
    .from(docsFolderMembers)
    .where(
      and(
        eq(docsFolderMembers.folderId, folderId),
        eq(docsFolderMembers.tenantId, tenantId),
        eq(docsFolderMembers.userId, userId),
      ),
    );
  if (!membership || membership.role !== 'owner') {
    return {
      ok: false as const,
      error: "You don't have permission to manage sharing for this folder.",
    };
  }
  return { ok: true as const, db, userId, tenantId };
}

/** Directory typeahead for the share dialog's member picker. */
export async function searchFolderDirectoryUsers(
  folderId: string,
  query: string,
): Promise<DirectoryUser[]> {
  const context = await requireOwner(folderId);
  if (!context.ok) return [];
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return sdk.directory.searchUsers({ query: trimmed, limit: 8 });
}

export interface FolderMemberView {
  userId: string;
  role: FolderMemberRole;
  name: string | null;
  email: string;
}

export async function listFolderMembers(folderId: string): Promise<FolderMemberView[]> {
  const context = await requireOwner(folderId);
  if (!context.ok) return [];
  const { db, tenantId } = context;

  const rows = await db
    .select({ userId: docsFolderMembers.userId, role: docsFolderMembers.role })
    .from(docsFolderMembers)
    .where(and(eq(docsFolderMembers.folderId, folderId), eq(docsFolderMembers.tenantId, tenantId)));
  if (rows.length === 0) return [];

  const profiles = await sdk.directory.resolveUsers({ ids: rows.map((row) => row.userId) });
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return rows.map((row) => {
    const profile = profileById.get(row.userId);
    return {
      userId: row.userId,
      role: row.role,
      name: profile?.name ?? null,
      email: profile?.email ?? 'Unknown user',
    };
  });
}

/** Adds a new member or changes an existing one's role — one action for both, mirroring `inviteDocumentMember`'s upsert. */
export async function inviteFolderMember(
  folderId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOwner(folderId);
  if (!context.ok) return context;
  const { db, tenantId, userId } = context;

  const invitedUserId = String(formData.get('userId') ?? '').trim();
  const roleInput = String(formData.get('role') ?? '').trim();
  if (!invitedUserId) return { ok: false, error: 'Choose a person to add.' };
  if (!isFolderMemberRole(roleInput)) return { ok: false, error: 'Invalid role.' };

  const [invitedUser] = await sdk.directory.resolveUsers({ ids: [invitedUserId] });
  if (!invitedUser) return { ok: false, error: 'That user could not be found.' };

  const [folder] = await db
    .select({ name: docsFolders.name })
    .from(docsFolders)
    .where(and(eq(docsFolders.id, folderId), eq(docsFolders.tenantId, tenantId)));
  if (!folder) return { ok: false, error: 'Folder not found.' };

  const [existing] = await db
    .select({ role: docsFolderMembers.role })
    .from(docsFolderMembers)
    .where(
      and(
        eq(docsFolderMembers.folderId, folderId),
        eq(docsFolderMembers.tenantId, tenantId),
        eq(docsFolderMembers.userId, invitedUserId),
      ),
    );

  if (existing) {
    if (existing.role === 'owner' && roleInput !== 'owner') {
      const owners = await db
        .select({ userId: docsFolderMembers.userId })
        .from(docsFolderMembers)
        .where(
          and(
            eq(docsFolderMembers.folderId, folderId),
            eq(docsFolderMembers.tenantId, tenantId),
            eq(docsFolderMembers.role, 'owner'),
          ),
        );
      if (owners.length <= 1) return { ok: false, error: 'The last owner cannot be demoted.' };
    }
    await db
      .update(docsFolderMembers)
      .set({ role: roleInput })
      .where(
        and(
          eq(docsFolderMembers.folderId, folderId),
          eq(docsFolderMembers.tenantId, tenantId),
          eq(docsFolderMembers.userId, invitedUserId),
        ),
      );
  } else {
    await db.insert(docsFolderMembers).values({
      folderId,
      userId: invitedUserId,
      tenantId,
      role: roleInput,
      invitedBy: userId,
      joinedAt: now(),
    });
    await notifyMember(invitedUserId, folder.name, folderId, roleInput);
    await emailMember(invitedUser.email, folder.name, folderId);
  }

  revalidatePath(`/f/${folderId}`);
  return { ok: true, message: `Added ${invitedUser.name ?? invitedUser.email} as ${roleInput}.` };
}

export async function removeFolderMember(
  folderId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const context = await requireOwner(folderId);
  if (!context.ok) return context;
  const { db, tenantId } = context;

  const members = await db
    .select({ userId: docsFolderMembers.userId, role: docsFolderMembers.role })
    .from(docsFolderMembers)
    .where(and(eq(docsFolderMembers.folderId, folderId), eq(docsFolderMembers.tenantId, tenantId)));
  const target = members.find((member) => member.userId === memberUserId);
  if (!target) return { ok: true };

  // Callers reach this point only as an existing owner (requireOwner), so if
  // exactly one owner-role row remains, it can only be the caller — this
  // blocks the last owner from removing themselves (or, equivalently here,
  // anyone) without needing a separate "is this me" check.
  const ownerCount = members.filter((member) => member.role === 'owner').length;
  if (target.role === 'owner' && ownerCount <= 1) {
    return { ok: false, error: 'The last owner cannot be removed.' };
  }

  await db
    .delete(docsFolderMembers)
    .where(
      and(
        eq(docsFolderMembers.folderId, folderId),
        eq(docsFolderMembers.tenantId, tenantId),
        eq(docsFolderMembers.userId, memberUserId),
      ),
    );

  revalidatePath(`/f/${folderId}`);
  return { ok: true };
}
