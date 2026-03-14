import { describe, expect, it } from 'vitest';
import { check, loadCommonDictionary } from '../src/index.js';

describe('common capitalization and spelling rules', () => {
  it('flags lowercase sentence starts', () => {
    const issues = check('once upon a time. there was a cat.', {
      packs: ['common'],
      role: 'subeditor',
    });

    const capitalization = issues.filter((issue) => issue.rule === 'COMMON-CAPS-01');
    expect(capitalization.length).toBeGreaterThan(0);
    expect(capitalization[0].originalText).toBe('once');
    expect(capitalization[0].suggestion).toBe('Once');
  });

  it('flags words missing from the loaded dictionary', () => {
    loadCommonDictionary(['hello', 'world', 'there', 'was', 'a', 'cat']);

    const issues = check('hello wurld', {
      packs: ['common'],
      role: 'subeditor',
    });

    const spelling = issues.filter((issue) => issue.rule === 'COMMON-SPELL-01');
    expect(spelling.length).toBe(1);
    expect(spelling[0].originalText).toBe('wurld');
  });
});
