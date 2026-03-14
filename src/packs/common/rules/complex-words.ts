import type { RuleFunction, Issue } from '../../../types.js';
import { COMPLEX_WORDS } from '../data/complex-words.js';

export const checkComplexWords: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];

  for (const phrase in COMPLEX_WORDS) {
    const suggestions = COMPLEX_WORDS[phrase];
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'gi');
    let match: RegExpExecArray | null;

    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      issues.push({
        rule: 'COMMON-COMPLEX-01',
        name: 'Complex word',
        category: 'readability',
        severity: 'warning',
        originalText: match[0],
        suggestion: suggestions.join(', '),
        description: `"${match[0]}" can be simplified to: ${suggestions.join(', ')}`,
        offset: match.index,
        length: match[0].length,
        canFix: suggestions.length === 1,
        meta: { suggestions },
      });

      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
  }

  issues.sort((a, b) => a.offset - b.offset);
  return issues;
};
