import type { Issue, RuleFunction } from '../../../types.js';

const SENTENCE_START_PATTERN = /(^|[.!?]\s+|\n\s*)(["'([{]*)([a-z][a-z'’-]*)/gm;

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export const checkCapitalization: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];
  let match: RegExpExecArray | null;

  while ((match = SENTENCE_START_PATTERN.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const wrappers = match[2] ?? '';
    const word = match[3];
    const offset = match.index + prefix.length + wrappers.length;

    issues.push({
      rule: 'COMMON-CAPS-01',
      name: 'Sentence capitalization',
      category: 'capitalization',
      severity: 'warning',
      originalText: word,
      suggestion: capitalizeWord(word),
      description: 'Capitalize the first word of a sentence or paragraph.',
      offset,
      length: word.length,
      canFix: true,
    });

    if (match.index === SENTENCE_START_PATTERN.lastIndex) {
      SENTENCE_START_PATTERN.lastIndex += 1;
    }
  }

  return issues;
};
