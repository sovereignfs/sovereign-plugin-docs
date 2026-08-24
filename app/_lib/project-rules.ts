export type ProjectMemberRole = 'owner' | 'editor' | 'viewer';

/** Whether a `docs_project_members` role may edit the project's documents. */
export function canEditProjectRole(role: ProjectMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/** Type guard for a `docs_project_members.role` value submitted from a share/invite form. */
export function isProjectMemberRole(value: string): value is ProjectMemberRole {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}
