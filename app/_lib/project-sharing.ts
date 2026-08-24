'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { docsProjectMembers, docsProjects } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { type ProjectMemberRole, isProjectMemberRole } from './project-rules';

/**
 * Best-effort in-app alert for a new share — a failure here (the
 * notification center being briefly unavailable) must never block an invite
 * that already succeeded. Same reasoning applies to `emailMember` below.
 * Ported from `sharing.ts`'s document-level equivalent.
 */
async function notifyMember(
  recipientUserId: string,
  projectName: string,
  projectId: string,
  role: ProjectMemberRole,
) {
  try {
    await sdk.notifications.send(
      {
        recipientUserId,
        title: 'Shared a project with you',
        body: `You were added to "${projectName}" as ${role}.`,
        url: `/docs/projects/${projectId}`,
      },
      await headers(),
    );
  } catch {
    // See docblock above.
  }
}

async function emailMember(email: string, projectName: string, projectId: string) {
  try {
    await sdk.mailer.send({
      to: email,
      subject: `You've been added to "${projectName}"`,
      text: `You now have access to "${projectName}" in Sovereign Docs.\n\nOpen it: /docs/projects/${projectId}`,
    });
  } catch {
    // See notifyMember's docblock.
  }
}

/**
 * Only a project's owner manages sharing (invite/remove/role-change) or
 * sees the member list — same gating `sharing.ts`'s `requireOwner` applies
 * to documents. A project role does grant document access (the "shared
 * folder" model, see `documents.ts`'s `resolveDocumentRole`), but does
 * **not** extend to managing the project's own sharing.
 */
async function requireOwner(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  const [membership] = await db
    .select({ role: docsProjectMembers.role })
    .from(docsProjectMembers)
    .where(
      and(
        eq(docsProjectMembers.projectId, projectId),
        eq(docsProjectMembers.tenantId, tenantId),
        eq(docsProjectMembers.userId, userId),
      ),
    );
  if (!membership || membership.role !== 'owner') {
    return {
      ok: false as const,
      error: "You don't have permission to manage sharing for this project.",
    };
  }
  return { ok: true as const, db, userId, tenantId };
}

/** Directory typeahead for the share dialog's member picker. */
export async function searchProjectDirectoryUsers(
  projectId: string,
  query: string,
): Promise<DirectoryUser[]> {
  const context = await requireOwner(projectId);
  if (!context.ok) return [];
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return sdk.directory.searchUsers({ query: trimmed, limit: 8 });
}

export interface ProjectMemberView {
  userId: string;
  role: ProjectMemberRole;
  name: string | null;
  email: string;
}

export async function listProjectMembers(projectId: string): Promise<ProjectMemberView[]> {
  const context = await requireOwner(projectId);
  if (!context.ok) return [];
  const { db, tenantId } = context;

  const rows = await db
    .select({ userId: docsProjectMembers.userId, role: docsProjectMembers.role })
    .from(docsProjectMembers)
    .where(and(eq(docsProjectMembers.projectId, projectId), eq(docsProjectMembers.tenantId, tenantId)));
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
export async function inviteProjectMember(
  projectId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOwner(projectId);
  if (!context.ok) return context;
  const { db, tenantId, userId } = context;

  const invitedUserId = String(formData.get('userId') ?? '').trim();
  const roleInput = String(formData.get('role') ?? '').trim();
  if (!invitedUserId) return { ok: false, error: 'Choose a person to add.' };
  if (!isProjectMemberRole(roleInput)) return { ok: false, error: 'Invalid role.' };

  const [invitedUser] = await sdk.directory.resolveUsers({ ids: [invitedUserId] });
  if (!invitedUser) return { ok: false, error: 'That user could not be found.' };

  const [project] = await db
    .select({ name: docsProjects.name })
    .from(docsProjects)
    .where(and(eq(docsProjects.id, projectId), eq(docsProjects.tenantId, tenantId)));
  if (!project) return { ok: false, error: 'Project not found.' };

  const [existing] = await db
    .select({ role: docsProjectMembers.role })
    .from(docsProjectMembers)
    .where(
      and(
        eq(docsProjectMembers.projectId, projectId),
        eq(docsProjectMembers.tenantId, tenantId),
        eq(docsProjectMembers.userId, invitedUserId),
      ),
    );

  if (existing) {
    if (existing.role === 'owner' && roleInput !== 'owner') {
      const owners = await db
        .select({ userId: docsProjectMembers.userId })
        .from(docsProjectMembers)
        .where(
          and(
            eq(docsProjectMembers.projectId, projectId),
            eq(docsProjectMembers.tenantId, tenantId),
            eq(docsProjectMembers.role, 'owner'),
          ),
        );
      if (owners.length <= 1) return { ok: false, error: 'The last owner cannot be demoted.' };
    }
    await db
      .update(docsProjectMembers)
      .set({ role: roleInput })
      .where(
        and(
          eq(docsProjectMembers.projectId, projectId),
          eq(docsProjectMembers.tenantId, tenantId),
          eq(docsProjectMembers.userId, invitedUserId),
        ),
      );
  } else {
    await db.insert(docsProjectMembers).values({
      projectId,
      userId: invitedUserId,
      tenantId,
      role: roleInput,
      invitedBy: userId,
      joinedAt: now(),
    });
    await notifyMember(invitedUserId, project.name, projectId, roleInput);
    await emailMember(invitedUser.email, project.name, projectId);
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: `Added ${invitedUser.name ?? invitedUser.email} as ${roleInput}.` };
}

export async function removeProjectMember(
  projectId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const context = await requireOwner(projectId);
  if (!context.ok) return context;
  const { db, tenantId } = context;

  const members = await db
    .select({ userId: docsProjectMembers.userId, role: docsProjectMembers.role })
    .from(docsProjectMembers)
    .where(and(eq(docsProjectMembers.projectId, projectId), eq(docsProjectMembers.tenantId, tenantId)));
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
    .delete(docsProjectMembers)
    .where(
      and(
        eq(docsProjectMembers.projectId, projectId),
        eq(docsProjectMembers.tenantId, tenantId),
        eq(docsProjectMembers.userId, memberUserId),
      ),
    );

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
