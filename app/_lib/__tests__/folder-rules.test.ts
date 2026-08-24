import { describe, expect, it } from 'vitest';
import { canEditFolderRole, isFolderMemberRole } from '../folder-rules';

describe('canEditFolderRole', () => {
  it('allows owner and editor roles', () => {
    expect(canEditFolderRole('owner')).toBe(true);
    expect(canEditFolderRole('editor')).toBe(true);
  });

  it('blocks viewer and missing/null roles', () => {
    expect(canEditFolderRole('viewer')).toBe(false);
    expect(canEditFolderRole(null)).toBe(false);
    expect(canEditFolderRole(undefined)).toBe(false);
  });
});

describe('isFolderMemberRole', () => {
  it('accepts owner, editor, and viewer', () => {
    expect(isFolderMemberRole('owner')).toBe(true);
    expect(isFolderMemberRole('editor')).toBe(true);
    expect(isFolderMemberRole('viewer')).toBe(true);
  });

  it('rejects anything else, including case variants and empty input', () => {
    expect(isFolderMemberRole('admin')).toBe(false);
    expect(isFolderMemberRole('Owner')).toBe(false);
    expect(isFolderMemberRole('')).toBe(false);
  });
});
