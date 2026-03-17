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

    // First pass: greedy longest-match segmentation
    const segments: Array<{ start: number; length: number; matched: number }> = [];
    let cursor = 0;

    while (cursor < originalRun.length) {
      const matchedLength = findLongestHanMatch(originalRun, cursor);
      segments.push({ start: cursor, length: 1, matched: matchedLength });
      if (matchedLength > 1) {
        cursor += matchedLength;
      } else {
        cursor += 1;
      }
    }

    // Flag characters that only matched at length 1 (single-char fallback).
    // A run of consecutive single-char matches suggests a broken phrase —
    // likely a pinyin homophone substitution.
    // Skip isolated single chars (particles, punctuation-adjacent) by requiring
    // at least 2 consecutive single-char-only matches, OR a single char that
    // is not in the dictionary at all.
    let i = 0;
    while (i < segments.length) {
      const seg = segments[i];

      // Character not in dict at all — always flag
      if (seg.matched === 0) {
        const issueStart = seg.start;
        let end = seg.start + 1;
        while (i + 1 < segments.length && segments[i + 1].matched === 0) {
          i += 1;
          end = segments[i].start + 1;
        }
        const original = originalRun.slice(issueStart, end);
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
        i += 1;
        continue;
      }

      // Matched a multi-char phrase — fine
      if (seg.matched > 1) {
        i += 1;
        continue;
      }

      // Single-char match — check if it's part of a suspicious run.
      // Count consecutive single-char-only segments.
      const runStart = i;
      while (i < segments.length && segments[i].matched === 1) {
        i += 1;
      }
      const runLen = i - runStart;

      // 3+ consecutive single-char matches with no phrase found = suspicious
      if (runLen >= 3) {
        const first = segments[runStart];
        const last = segments[i - 1];
        const original = originalRun.slice(first.start, last.start + 1);
        issues.push({
          rule: 'COMMON-SPELL-01',
          name: 'Possible spelling issue',
          category: 'spelling',
          severity: 'info',
          originalText: original,
          suggestion: null,
          description: `No known phrase found for "${original}" — possible wrong character from pinyin input.`,
          offset: runOffset + first.start,
          length: original.length,
          canFix: false,
        });
      }
      // Single isolated char between phrases — likely a particle, skip
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
