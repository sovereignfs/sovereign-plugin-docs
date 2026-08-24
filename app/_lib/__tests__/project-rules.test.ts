import { describe, expect, it } from 'vitest';
import { canEditProjectRole, isProjectMemberRole } from '../project-rules';

describe('canEditProjectRole', () => {
  it('allows owner and editor roles', () => {
    expect(canEditProjectRole('owner')).toBe(true);
    expect(canEditProjectRole('editor')).toBe(true);
  });

  it('blocks viewer and missing/null roles', () => {
    expect(canEditProjectRole('viewer')).toBe(false);
    expect(canEditProjectRole(null)).toBe(false);
    expect(canEditProjectRole(undefined)).toBe(false);
  });
});

describe('isProjectMemberRole', () => {
  it('accepts owner, editor, and viewer', () => {
    expect(isProjectMemberRole('owner')).toBe(true);
    expect(isProjectMemberRole('editor')).toBe(true);
    expect(isProjectMemberRole('viewer')).toBe(true);
  });

  it('rejects anything else, including case variants and empty input', () => {
    expect(isProjectMemberRole('admin')).toBe(false);
    expect(isProjectMemberRole('Owner')).toBe(false);
    expect(isProjectMemberRole('')).toBe(false);
  });
});
