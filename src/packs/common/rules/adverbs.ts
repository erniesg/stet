import type { RuleFunction, Issue } from '../../../types.js';
import { ADVERB_EXCLUSIONS } from '../data/adverb-exclusions.js';

const adverbRegex = /\b([a-zA-Z]+ly)\b/gi;

export const checkAdverbs: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];

  adverbRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = adverbRegex.exec(text)) !== null) {
    const adverb = match[1];
    const lower = adverb.toLowerCase();

    if (!ADVERB_EXCLUSIONS[lower]) {
      issues.push({
        rule: 'COMMON-ADV-01',
        name: 'Adverb',
        category: 'readability',
        severity: 'info',
        originalText: adverb,
        suggestion: null,
        description: `"${adverb}" — consider if this adverb is necessary.`,
        offset: match.index,
        length: adverb.length,
        canFix: false,
      });
    }

    if (match.index === adverbRegex.lastIndex) adverbRegex.lastIndex++;
  }

  return issues;
};
