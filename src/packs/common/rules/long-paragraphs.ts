import type { RuleFunction, Issue } from '../../../types.js';

const DEFAULT_CHAR_LIMIT = 320;

export const checkLongParagraphs: RuleFunction = (text, ctx): Issue[] => {
  const limit = ctx.packConfig.paragraphCharLimit ?? DEFAULT_CHAR_LIMIT;
  if (text.length <= limit) return [];

  return [{
    rule: 'COMMON-PARA-01',
    name: 'Long paragraph',
    category: 'readability',
    severity: 'warning',
    originalText: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
    suggestion: null,
    description: `Paragraph is ${text.length} characters (limit: ${limit}). Consider breaking it up.`,
    offset: 0,
    length: text.length,
    canFix: false,
    meta: { charCount: text.length, limit, overLimit: text.length - limit },
  }];
};
