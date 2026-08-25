'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { docsDocumentMembers, docsDocuments } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { type DocumentMemberRole, isDocumentMemberRole } from './document-rules';

/**
 * Best-effort in-app alert for a new share — a failure here (the
 * notification center being briefly unavailable) must never block an invite
 * that already succeeded. Same reasoning applies to `emailMember` below.
 */
async function notifyMember(
  recipientUserId: string,
  documentTitle: string,
  documentId: string,
  role: DocumentMemberRole,
) {
  try {
    await sdk.notifications.send(
      {
        recipientUserId,
        title: 'Shared a document with you',
        body: `You were added to "${documentTitle}" as ${role}.`,
        url: `/docs/d/${documentId}`,
      },
      await headers(),
    );
  } catch {
    // See docblock above.
  }
}

async function emailMember(email: string, documentTitle: string, documentId: string) {
  try {
    await sdk.mailer.send({
      to: email,
      subject: `You've been added to "${documentTitle}"`,
      text: `You now have access to "${documentTitle}" in Sovereign Docs.\n\nOpen it: /docs/d/${documentId}`,
    });
  } catch {
    // See notifyMember's docblock.
  }
}

/**
 * Only a document's owner manages sharing (invite/remove/role-change) or
 * sees the member list — matching the `sovereign-plainwrite` project-sharing
 * precedent this is ported from. Returns a result rather than throwing, so
 * every caller surfaces the same plain-language error instead of a 500.
 */
async function requireOwner(documentId: string) {
  const { db, userId, tenantId } = await getContext();
  const [membership] = await db
    .select({ role: docsDocumentMembers.role })
    .from(docsDocumentMembers)
    .where(
      and(
        eq(docsDocumentMembers.documentId, documentId),
        eq(docsDocumentMembers.tenantId, tenantId),
        eq(docsDocumentMembers.userId, userId),
      ),
    );
  if (!membership || membership.role !== 'owner') {
    return {
      ok: false as const,
      error: "You don't have permission to manage sharing for this document.",
    };
  }
  return { ok: true as const, db, userId, tenantId };
}

/** Directory typeahead for the share dialog's member picker. */
export async function searchDocumentDirectoryUsers(
  documentId: string,
  query: string,
): Promise<DirectoryUser[]> {
  const context = await requireOwner(documentId);
  if (!context.ok) return [];
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return sdk.directory.searchUsers({ query: trimmed, limit: 8 });
}

export interface DocumentMemberView {
  userId: string;
  role: DocumentMemberRole;
  name: string | null;
  email: string;
}

export async function listDocumentMembers(documentId: string): Promise<DocumentMemberView[]> {
  const context = await requireOwner(documentId);
  if (!context.ok) return [];
  const { db, tenantId } = context;

  const rows = await db
    .select({ userId: docsDocumentMembers.userId, role: docsDocumentMembers.role })
    .from(docsDocumentMembers)
    .where(
      and(eq(docsDocumentMembers.documentId, documentId), eq(docsDocumentMembers.tenantId, tenantId)),
    );
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

/** Adds a new member or changes an existing one's role — one action for both, mirroring the plainwrite invite form's upsert. */
export async function inviteDocumentMember(
  documentId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOwner(documentId);
  if (!context.ok) return context;
  const { db, tenantId, userId } = context;

  const invitedUserId = String(formData.get('userId') ?? '').trim();
  const roleInput = String(formData.get('role') ?? '').trim();
  if (!invitedUserId) return { ok: false, error: 'Choose a person to add.' };
  if (!isDocumentMemberRole(roleInput)) return { ok: false, error: 'Invalid role.' };

  // Resolve against the platform directory before inserting a membership row
  // — otherwise a stale/typo'd id silently creates a phantom member that
  // never shows up anywhere (listDocumentMembers filters display fields
  // through the same resolveUsers call, so it would just render blank).
  const [invitedUser] = await sdk.directory.resolveUsers({ ids: [invitedUserId] });
  if (!invitedUser) return { ok: false, error: 'That user could not be found.' };

  const [doc] = await db
    .select({ title: docsDocuments.title })
    .from(docsDocuments)
    .where(and(eq(docsDocuments.id, documentId), eq(docsDocuments.tenantId, tenantId)));
  if (!doc) return { ok: false, error: 'Document not found.' };

  const [existing] = await db
    .select({ role: docsDocumentMembers.role })
    .from(docsDocumentMembers)
    .where(
      and(
        eq(docsDocumentMembers.documentId, documentId),
        eq(docsDocumentMembers.tenantId, tenantId),
        eq(docsDocumentMembers.userId, invitedUserId),
      ),
    );

  if (existing) {
    if (existing.role === 'owner' && roleInput !== 'owner') {
      const owners = await db
        .select({ userId: docsDocumentMembers.userId })
        .from(docsDocumentMembers)
        .where(
          and(
            eq(docsDocumentMembers.documentId, documentId),
            eq(docsDocumentMembers.tenantId, tenantId),
            eq(docsDocumentMembers.role, 'owner'),
          ),
        );
      if (owners.length <= 1) return { ok: false, error: 'The last owner cannot be demoted.' };
    }
    await db
      .update(docsDocumentMembers)
      .set({ role: roleInput })
      .where(
        and(
          eq(docsDocumentMembers.documentId, documentId),
          eq(docsDocumentMembers.tenantId, tenantId),
          eq(docsDocumentMembers.userId, invitedUserId),
        ),
      );
  } else {
    await db.insert(docsDocumentMembers).values({
      documentId,
      userId: invitedUserId,
      tenantId,
      role: roleInput,
      invitedBy: userId,
      joinedAt: now(),
    });
    await notifyMember(invitedUserId, doc.title, documentId, roleInput);
    await emailMember(invitedUser.email, doc.title, documentId);
  }

  revalidatePath(`/d/${documentId}`);
  return { ok: true, message: `Added ${invitedUser.name ?? invitedUser.email} as ${roleInput}.` };
}

export async function removeDocumentMember(
  documentId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const context = await requireOwner(documentId);
  if (!context.ok) return context;
  const { db, tenantId } = context;

  const members = await db
    .select({ userId: docsDocumentMembers.userId, role: docsDocumentMembers.role })
    .from(docsDocumentMembers)
    .where(
      and(eq(docsDocumentMembers.documentId, documentId), eq(docsDocumentMembers.tenantId, tenantId)),
    );
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
    .delete(docsDocumentMembers)
    .where(
      and(
        eq(docsDocumentMembers.documentId, documentId),
        eq(docsDocumentMembers.tenantId, tenantId),
        eq(docsDocumentMembers.userId, memberUserId),
      ),
    );

  revalidatePath(`/d/${documentId}`);
  return { ok: true };
}
