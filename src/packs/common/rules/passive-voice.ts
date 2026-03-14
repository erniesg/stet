import type { RuleFunction, Issue } from '../../../types.js';
import { IRREGULAR_PAST_PARTICIPLES } from '../data/passive-voice.js';

const passiveRegex = /\b(am|is|are|was|were|be|been|being)\s+([a-zA-Z]{3,}[a-zA-Z]*)(?:\s+by\b)?/gi;

export const checkPassiveVoice: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];

  passiveRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = passiveRegex.exec(text)) !== null) {
    const phrase = match[0];
    const participle = match[2];
    const lower = participle.toLowerCase();

    if (participle.endsWith('ed') || IRREGULAR_PAST_PARTICIPLES[lower]) {
      issues.push({
        rule: 'COMMON-PASSIVE-01',
        name: 'Passive voice',
        category: 'readability',
        severity: 'info',
        originalText: phrase,
        suggestion: null,
        description: 'Consider using active voice.',
        offset: match.index,
        length: phrase.length,
        canFix: false,
      });
    }

    if (match.index === passiveRegex.lastIndex) passiveRegex.lastIndex++;
  }

  return issues;
};
