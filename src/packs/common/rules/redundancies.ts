import type { RuleFunction, Issue } from '../../../types.js';
import { REDUNDANCIES } from '../data/redundancies.js';

/**
 * Flags redundant phrases where one word is unnecessary.
 * E.g., "free gift" → "gift", "past history" → "history"
 */
export const checkRedundancies: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];
  const lower = text.toLowerCase();

  for (const [phrase, concise] of Object.entries(REDUNDANCIES)) {
    let searchFrom = 0;
    while (true) {
      const idx = lower.indexOf(phrase, searchFrom);
      if (idx === -1) break;

      // Check word boundaries
      const before = idx > 0 ? lower[idx - 1] : ' ';
      const after = idx + phrase.length < lower.length ? lower[idx + phrase.length] : ' ';
      if (/\w/.test(before) || /\w/.test(after)) {
        searchFrom = idx + 1;
        continue;
      }

      const original = text.substring(idx, idx + phrase.length);

      issues.push({
        rule: 'COMMON-REDUN-01',
        name: 'Redundant phrase',
        category: 'readability',
        severity: 'info',
        originalText: original,
        suggestion: concise,
        description: `"${original}" is redundant — "${concise}" says the same thing.`,
        offset: idx,
        length: phrase.length,
        canFix: true,
      });

      searchFrom = idx + phrase.length;
    }
  }

  return issues;
};
