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

  it('flags non-standard Chinese terms and suggests SG equivalents', () => {
    const issues = check('记者乘坐出租车前往巴士转换站', {
      packs: ['common'],
      role: 'subeditor',
      enabledRules: ['COMMON-ZHSG-TERM-01'],
      configOverrides: { language: 'zh-SG' },
    });

    const term = issues.filter((issue) => issue.rule === 'COMMON-ZHSG-TERM-01');
    expect(term.length).toBe(1);
    expect(term[0].originalText).toBe('出租车');
    expect(term[0].suggestion).toBe('德士');
    expect(term[0].canFix).toBe(true);
  });

  it('flags multiple non-standard terms in one sentence', () => {
    const issues = check('他搭公共汽车去大排档', {
      packs: ['common'],
      role: 'subeditor',
      enabledRules: ['COMMON-ZHSG-TERM-01'],
      configOverrides: { language: 'zh-SG' },
    });

    const term = issues.filter((issue) => issue.rule === 'COMMON-ZHSG-TERM-01');
    expect(term.length).toBe(2);
    expect(term[0].originalText).toBe('公共汽车');
    expect(term[0].suggestion).toBe('巴士');
    expect(term[1].originalText).toBe('大排档');
    expect(term[1].suggestion).toBe('熟食中心');
  });

  it('does not flag correct SG Chinese terms', () => {
    const issues = check('人民协会和社区发展理事会在组屋区讨论公积金局的新政策', {
      packs: ['common'],
      role: 'subeditor',
      enabledRules: ['COMMON-ZHSG-TERM-01'],
      configOverrides: { language: 'zh-SG' },
    });

    expect(issues.filter((i) => i.rule === 'COMMON-ZHSG-TERM-01')).toEqual([]);
  });

  it('does not fire zh-SG terminology rule when language is en-GB', () => {
    const issues = check('出租车', {
      packs: ['common'],
      role: 'subeditor',
      configOverrides: { language: 'en-GB' },
    });

    expect(issues.filter((i) => i.rule === 'COMMON-ZHSG-TERM-01')).toEqual([]);
  });
});
