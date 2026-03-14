import type { Issue, RuleFunction } from '../../../types.js';

const dictionary = new Set<string>();
const WORD_PATTERN = /\b([A-Za-z][A-Za-z'’-]*)\b/g;

const COMMON_SHORT_FORMS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'pm', 'am', 'gov', 'no',
]);

export function loadCommonDictionary(words: string[]) {
  dictionary.clear();
  words.forEach((word) => {
    const normalized = normalizeWord(word);
    if (normalized) dictionary.add(normalized);
  });
}

export const checkSpelling: RuleFunction = (text): Issue[] => {
  if (dictionary.size === 0) return [];

  const issues: Issue[] = [];
  let match: RegExpExecArray | null;

  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const original = match[1];
    const normalized = normalizeWord(original);
    if (!normalized) continue;
    if (normalized.length <= 1) continue;
    if (COMMON_SHORT_FORMS.has(normalized)) continue;
    if (shouldSkipToken(original, normalized)) continue;
    if (dictionary.has(normalized)) continue;

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

    if (match.index === WORD_PATTERN.lastIndex) {
      WORD_PATTERN.lastIndex += 1;
    }
  }

  return issues;
};

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’]/g, '\'')
    .replace(/(^'+|'+$)/g, '')
    .replace(/'s$/i, '');
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
