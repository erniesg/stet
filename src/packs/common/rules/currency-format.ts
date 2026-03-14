import type { RuleFunction, Issue } from '../../../types.js';

/** Checks for bare $ without country prefix (US$, S$, A$, NT$) */
export const checkCurrencyFormat: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];
  const cleaned = text.replace(/\u00A0/g, ' ');

  const currencyPattern = /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|trillion|M|B|T|K|k)?/gi;
  let match: RegExpExecArray | null;

  while ((match = currencyPattern.exec(cleaned)) !== null) {
    const original = match[0];
    const start = match.index;

    // Check for valid prefix
    const prefixArea = cleaned.substring(Math.max(0, start - 4), start) + '$';
    const compact = prefixArea.replace(/\s+/g, '');
    if (['US$', 'S$', 'A$', 'NT$'].some(p => compact.endsWith(p))) continue;

    issues.push({
      rule: 'COMMON-CURFMT-01',
      name: 'Currency prefix',
      category: 'numbers',
      severity: 'warning',
      originalText: original,
      suggestion: 'US' + original,
      description: 'Add country prefix to dollar amounts (e.g., US$, S$, A$).',
      offset: start,
      length: original.length,
      canFix: true,
    });

    if (match.index === currencyPattern.lastIndex) currencyPattern.lastIndex++;
  }

  // Check "X percent" -> "X%"
  const percentPattern = /\b(\d+(?:\.\d+)?)\s+percent\b/gi;
  while ((match = percentPattern.exec(text)) !== null) {
    issues.push({
      rule: 'COMMON-CURFMT-01',
      name: 'Percentage format',
      category: 'numbers',
      severity: 'warning',
      originalText: match[0],
      suggestion: match[1] + '%',
      description: 'Use % symbol instead of "percent".',
      offset: match.index,
      length: match[0].length,
      canFix: true,
    });

    if (match.index === percentPattern.lastIndex) percentPattern.lastIndex++;
  }

  return issues;
};
