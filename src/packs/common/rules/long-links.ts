import type { RuleFunction, Issue } from '../../../types.js';

const LINK_WORD_LIMIT = 4;
const markdownLinkRegex = /\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;

export const checkLongLinks: RuleFunction = (text, ctx): Issue[] => {
  // Skip for newsletters
  if (ctx.documentMetadata?.isNewsletter) return [];

  const issues: Issue[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  markdownLinkRegex.lastIndex = 0;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    const linkText = match[1].trim();
    const wordCount = linkText.split(/\s+/).filter(w => w.length > 0).length;

    if (wordCount > LINK_WORD_LIMIT && !seen.has(linkText)) {
      seen.add(linkText);
      issues.push({
        rule: 'COMMON-LINK-01',
        name: 'Long link text',
        category: 'readability',
        severity: 'warning',
        originalText: match[0],
        suggestion: null,
        description: `Link text is ${wordCount} words (limit: ${LINK_WORD_LIMIT}). Shorten it.`,
        offset: match.index,
        length: match[0].length,
        canFix: false,
        meta: { linkText, wordCount, limit: LINK_WORD_LIMIT },
      });
    }
  }

  return issues;
};
