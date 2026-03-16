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

  it('accepts zh-SG words that exist in the loaded Chinese dictionary', () => {
    loadCommonDictionary(['我', '在', '巴士转换站', '等', '巴士']);

    const issues = check('我在巴士转换站等巴士', {
      packs: ['common'],
      role: 'subeditor',
      enabledRules: ['COMMON-SPELL-01'],
      configOverrides: { language: 'zh-SG' },
    });

    const spelling = issues.filter((issue) => issue.rule === 'COMMON-SPELL-01');
    expect(spelling).toEqual([]);
  });

  it('flags Han tokens missing from the loaded zh-SG dictionary', () => {
    loadCommonDictionary(['我', '在', '巴士', '站', '等', '德士']);

    const issues = check('我在巴士詀等德士', {
      packs: ['common'],
      role: 'subeditor',
      enabledRules: ['COMMON-SPELL-01'],
      configOverrides: { language: 'zh-SG' },
    });

    const spelling = issues.filter((issue) => issue.rule === 'COMMON-SPELL-01');
    expect(spelling.length).toBe(1);
    expect(spelling[0].originalText).toBe('詀');
  });
});
