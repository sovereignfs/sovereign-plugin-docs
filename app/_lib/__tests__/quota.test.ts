import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEnvMock = vi.fn<(key: string) => Promise<string | null>>();

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    env: { get: (key: string) => getEnvMock(key) },
  },
}));

describe('parseFreeDocLimit', () => {
  it('defaults to 25 when the value is null', async () => {
    const { parseFreeDocLimit, DEFAULT_FREE_DOC_LIMIT } = await import('../quota');
    expect(parseFreeDocLimit(null)).toBe(DEFAULT_FREE_DOC_LIMIT);
    expect(DEFAULT_FREE_DOC_LIMIT).toBe(25);
  });

  it('defaults to 25 when the value is undefined or blank', async () => {
    const { parseFreeDocLimit } = await import('../quota');
    expect(parseFreeDocLimit(undefined)).toBe(25);
    expect(parseFreeDocLimit('')).toBe(25);
    expect(parseFreeDocLimit('   ')).toBe(25);
  });

  it('defaults to 25 when the value is non-numeric', async () => {
    const { parseFreeDocLimit } = await import('../quota');
    expect(parseFreeDocLimit('not-a-number')).toBe(25);
  });

  it('defaults to 25 when the value is not an integer', async () => {
    const { parseFreeDocLimit } = await import('../quota');
    expect(parseFreeDocLimit('10.5')).toBe(25);
  });

  it('defaults to 25 when the value is zero or negative', async () => {
    const { parseFreeDocLimit } = await import('../quota');
    expect(parseFreeDocLimit('0')).toBe(25);
    expect(parseFreeDocLimit('-5')).toBe(25);
  });

  it('parses a valid positive integer string', async () => {
    const { parseFreeDocLimit } = await import('../quota');
    expect(parseFreeDocLimit('50')).toBe(50);
    expect(parseFreeDocLimit('1')).toBe(1);
  });

  it('tolerates surrounding whitespace', async () => {
    const { parseFreeDocLimit } = await import('../quota');
    expect(parseFreeDocLimit('  50  ')).toBe(50);
  });
});

describe('getFreeDocLimit', () => {
  beforeEach(() => {
    getEnvMock.mockReset();
  });

  it("reads the operator's FREE_DOC_LIMIT env var", async () => {
    getEnvMock.mockResolvedValue('100');
    const { getFreeDocLimit } = await import('../quota');
    expect(await getFreeDocLimit()).toBe(100);
    expect(getEnvMock).toHaveBeenCalledWith('FREE_DOC_LIMIT');
  });

  it('falls back to the default when unset', async () => {
    getEnvMock.mockResolvedValue(null);
    const { getFreeDocLimit } = await import('../quota');
    expect(await getFreeDocLimit()).toBe(25);
  });
});

describe('canCreateDbDocument', () => {
  it('allows creation while under the limit', async () => {
    const { canCreateDbDocument } = await import('../quota');
    expect(canCreateDbDocument(0, 25)).toBe(true);
    expect(canCreateDbDocument(24, 25)).toBe(true);
  });

  it('blocks creation at or above the limit', async () => {
    const { canCreateDbDocument } = await import('../quota');
    expect(canCreateDbDocument(25, 25)).toBe(false);
    expect(canCreateDbDocument(30, 25)).toBe(false);
  });
});
