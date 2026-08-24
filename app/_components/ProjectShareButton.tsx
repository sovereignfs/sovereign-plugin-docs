'use client';

import { useState } from 'react';
import { Button } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/context';
import type { ProjectMemberView } from '../_lib/project-sharing';
import { ProjectShareDialog } from './ProjectShareDialog';

interface ProjectShareButtonProps {
  listMembersAction: () => Promise<ProjectMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  removeAction: (userId: string) => Promise<ActionResult>;
}

/** Project detail page's Share entry point — owner-only, mirrors DocumentPage's own Share button/dialog pairing. */
export function ProjectShareButton({
  listMembersAction,
  searchUsersAction,
  inviteAction,
  removeAction,
}: ProjectShareButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Share
      </Button>
      <ProjectShareDialog
        open={open}
        onClose={() => setOpen(false)}
        listMembersAction={listMembersAction}
        searchUsersAction={searchUsersAction}
        inviteAction={inviteAction}
        removeAction={removeAction}
      />
    </>
  );
}
