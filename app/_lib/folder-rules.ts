export type FolderMemberRole = 'owner' | 'editor' | 'viewer';

/** Whether a `docs_folder_members` role may edit the folder's documents. */
export function canEditFolderRole(role: FolderMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/** Type guard for a `docs_folder_members.role` value submitted from a share/invite form. */
export function isFolderMemberRole(value: string): value is FolderMemberRole {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}
