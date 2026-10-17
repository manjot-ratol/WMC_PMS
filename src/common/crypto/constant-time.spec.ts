import { constantTimeEquals } from './constant-time';

describe('constantTimeEquals', () => {
  it('returns true for equal strings', () =>
    expect(constantTimeEquals('abc', 'abc')).toBe(true));
  it('returns false for different strings of the same length', () =>
    expect(constantTimeEquals('abc', 'abd')).toBe(false));
  it('returns false on length mismatch without throwing', () =>
    expect(constantTimeEquals('abc', 'abcd')).toBe(false));
  it('handles empty strings', () =>
    expect(constantTimeEquals('', '')).toBe(true));
});
