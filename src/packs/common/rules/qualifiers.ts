import type { RuleFunction, Issue } from '../../../types.js';
import { QUALIFIERS } from '../data/qualifiers.js';

export const checkQualifiers: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];

  for (const phrase in QUALIFIERS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'gi');
    let match: RegExpExecArray | null;

    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      issues.push({
        rule: 'COMMON-QUAL-01',
        name: 'Qualifier',
        category: 'readability',
        severity: 'info',
        originalText: match[0],
        suggestion: null,
        description: `"${match[0]}" weakens the statement. Remove or rephrase.`,
        offset: match.index,
        length: match[0].length,
        canFix: false,
      });

      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
  }

  issues.sort((a, b) => a.offset - b.offset);
  return issues;
};
