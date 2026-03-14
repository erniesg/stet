import { describe, expect, it } from 'vitest';
import { getReplacementText } from '../packages/extension/src/content/replacement-text.js';

describe('replacement text casing', () => {
  it('capitalizes a replacement at sentence start', () => {
    const next = getReplacementText(
      'Prior to January, inflation remained steady.',
      0,
      'Prior to',
      'before',
    );

    expect(next).toBe('Before');
  });

  it('does not capitalize a replacement mid-sentence', () => {
    const next = getReplacementText(
      'Inflation held steady prior to January.',
      'Inflation held steady '.length,
      'prior to',
      'before',
    );

    expect(next).toBe('before');
  });

  it('preserves all-caps replacements', () => {
    const next = getReplacementText(
      'NASA released new figures.',
      0,
      'NASA',
      'agency',
    );

    expect(next).toBe('AGENCY');
  });
});
