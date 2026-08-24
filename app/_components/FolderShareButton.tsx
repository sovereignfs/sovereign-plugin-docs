'use client';

import { useState } from 'react';
import { Button } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/context';
import type { FolderMemberView } from '../_lib/folder-sharing';
import { FolderShareDialog } from './FolderShareDialog';

interface FolderShareButtonProps {
  listMembersAction: () => Promise<FolderMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  removeAction: (userId: string) => Promise<ActionResult>;
}

/** Folder detail page's Share entry point — owner-only, mirrors DocumentPage's own Share button/dialog pairing. */
export function FolderShareButton({
  listMembersAction,
  searchUsersAction,
  inviteAction,
  removeAction,
}: FolderShareButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Share
      </Button>
      <FolderShareDialog
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
