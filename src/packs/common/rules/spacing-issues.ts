import type { RuleFunction, Issue } from '../../../types.js';

export const checkSpacingIssues: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];

  // Double spaces
  const doubleRegex = / {2,}/g;
  let match: RegExpExecArray | null;
  while ((match = doubleRegex.exec(text)) !== null) {
    issues.push({
      rule: 'COMMON-SPACE-01',
      name: 'Double space',
      category: 'readability',
      severity: 'info',
      originalText: match[0],
      suggestion: ' ',
      description: 'Remove extra spaces.',
      offset: match.index,
      length: match[0].length,
      canFix: true,
    });
  }

  // Trailing whitespace
  const trimmed = text.trimEnd();
  if (text.length !== trimmed.length) {
    const trailStart = trimmed.length;
    issues.push({
      rule: 'COMMON-SPACE-01',
      name: 'Trailing whitespace',
      category: 'readability',
      severity: 'info',
      originalText: text.substring(trailStart),
      suggestion: '',
      description: 'Remove trailing whitespace.',
      offset: trailStart,
      length: text.length - trailStart,
      canFix: true,
    });
  }

  return issues;
};
