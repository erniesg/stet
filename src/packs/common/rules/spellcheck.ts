import type { Issue, RuleFunction, Language } from '../../../types.js';

const latinDictionary = new Set<string>();
const hanDictionary = new Set<string>();
const LATIN_WORD_PATTERN = /\b([A-Za-z][A-Za-z'’-]*)\b/g;
const HAN_RUN_PATTERN = /\p{Script=Han}+/gu;
const HAN_ONLY_PATTERN = /^\p{Script=Han}+$/u;

const COMMON_SHORT_FORMS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'pm', 'am', 'gov', 'no',
]);
let maxHanWordLength = 1;

export function loadCommonDictionary(words: string[]) {
  latinDictionary.clear();
  hanDictionary.clear();
  maxHanWordLength = 1;

  words.forEach((word) => {
    const trimmed = word.trim();
    if (!trimmed) return;

    if (containsHan(trimmed)) {
      const normalized = normalizeHanWord(trimmed);
      if (!normalized) return;
      hanDictionary.add(normalized);
      maxHanWordLength = Math.max(maxHanWordLength, normalized.length);
      return;
    }

    const normalized = normalizeLatinWord(trimmed);
    if (normalized) latinDictionary.add(normalized);
  });
}

export const checkSpelling: RuleFunction = (text, ctx): Issue[] => {
  if (isChineseLanguage(ctx.packConfig.language)) {
    return checkHanSpelling(text);
  }

  return checkLatinSpelling(text);
};

function checkLatinSpelling(text: string): Issue[] {
  if (latinDictionary.size === 0) return [];

  LATIN_WORD_PATTERN.lastIndex = 0;
  const issues: Issue[] = [];
  let match: RegExpExecArray | null;

  while ((match = LATIN_WORD_PATTERN.exec(text)) !== null) {
    const original = match[1];
    const normalized = normalizeLatinWord(original);
    if (!normalized) continue;
    if (normalized.length <= 1) continue;
    if (COMMON_SHORT_FORMS.has(normalized)) continue;
    if (shouldSkipToken(original, normalized)) continue;
    if (latinDictionary.has(normalized)) continue;

    issues.push({
      rule: 'COMMON-SPELL-01',
      name: 'Possible spelling issue',
      category: 'spelling',
      severity: 'warning',
      originalText: original,
      suggestion: null,
      description: `Possible spelling issue: "${original}" is not in the loaded dictionary.`,
      offset: match.index,
      length: original.length,
      canFix: false,
    });

    if (match.index === LATIN_WORD_PATTERN.lastIndex) {
      LATIN_WORD_PATTERN.lastIndex += 1;
    }
  }

  return issues;
}

function checkHanSpelling(text: string): Issue[] {
  if (hanDictionary.size === 0) return [];

  const issues: Issue[] = [];

  for (const match of text.matchAll(HAN_RUN_PATTERN)) {
    const originalRun = match[0];
    const runOffset = match.index ?? 0;
    let cursor = 0;

    while (cursor < originalRun.length) {
      const matchedLength = findLongestHanMatch(originalRun, cursor);
      if (matchedLength > 0) {
        cursor += matchedLength;
        continue;
      }

      const issueStart = cursor;
      cursor += 1;

      while (cursor < originalRun.length && findLongestHanMatch(originalRun, cursor) === 0) {
        cursor += 1;
      }

      const original = originalRun.slice(issueStart, cursor);
      issues.push({
        rule: 'COMMON-SPELL-01',
        name: 'Possible spelling issue',
        category: 'spelling',
        severity: 'warning',
        originalText: original,
        suggestion: null,
        description: `Possible spelling issue: "${original}" is not in the loaded dictionary.`,
        offset: runOffset + issueStart,
        length: original.length,
        canFix: false,
      });
    }
  }

  return issues;
}

function normalizeLatinWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’]/g, '\'')
    .replace(/(^'+|'+$)/g, '')
    .replace(/'s$/i, '');
}

function normalizeHanWord(word: string): string {
  return word.trim();
}

function shouldSkipToken(original: string, normalized: string): boolean {
  if (!/[a-z]/i.test(original)) return true;
  if (/^[A-Z]{2,}$/.test(original)) return true;
  if (isCapitalizedWord(original)) return true;
  if (normalized.includes('--')) return true;
  return false;
}

function isCapitalizedWord(word: string): boolean {
  return /^[A-Z][a-z'’-]+$/.test(word);
}

function isChineseLanguage(language?: Language): boolean {
  return language === 'zh-SG';
}

function containsHan(word: string): boolean {
  return HAN_ONLY_PATTERN.test(word);
}

function findLongestHanMatch(text: string, start: number): number {
  const remaining = text.length - start;
  const maxLength = Math.min(maxHanWordLength, remaining);

  for (let length = maxLength; length > 0; length -= 1) {
    const candidate = normalizeHanWord(text.slice(start, start + length));
    if (hanDictionary.has(candidate)) {
      return length;
    }
  }

  return 0;
}
