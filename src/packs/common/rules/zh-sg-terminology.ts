import type { RuleFunction, Issue, Language } from '../../../types.js';
import { ZH_SG_TERMINOLOGY } from '../data/zh-sg-terminology.js';

export const checkZhSgTerminology: RuleFunction = (text, ctx): Issue[] => {
  if (ctx.packConfig.language !== 'zh-SG') return [];

  const issues: Issue[] = [];

  for (const [wrong, right] of Object.entries(ZH_SG_TERMINOLOGY)) {
    let idx = text.indexOf(wrong);
    while (idx !== -1) {
      issues.push({
        rule: 'COMMON-ZHSG-TERM-01',
        name: 'SG Chinese terminology',
        category: 'terminology',
        severity: 'warning',
        originalText: wrong,
        suggestion: right,
        description: `Use Singapore standard "${right}" instead of "${wrong}".`,
        offset: idx,
        length: wrong.length,
        canFix: true,
      });
      idx = text.indexOf(wrong, idx + wrong.length);
    }
  }

  return issues;
};
