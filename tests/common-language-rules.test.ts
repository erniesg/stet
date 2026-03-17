import { readFileSync } from 'node:fs';
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

  it('accepts a combined zh-SG newsroom sentence from the generated dictionary', () => {
    const words = readFileSync(new URL('../data/wordlist-zh-sg.txt', import.meta.url), 'utf8')
      .trim()
      .split('\n');
    loadCommonDictionary(words);

    const issues = check('人民协会和社区发展理事会在组屋区与居民委员会、市镇理事会谈易通卡、公路电子收费和巴士专用道。', {
      packs: ['common'],
      role: 'subeditor',
      enabledRules: ['COMMON-SPELL-01'],
      configOverrides: { language: 'zh-SG' },
    });

    const spelling = issues.filter((issue) => issue.rule === 'COMMON-SPELL-01');
    expect(spelling).toEqual([]);
  });
});
