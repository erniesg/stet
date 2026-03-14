import type { RuleFunction, Issue } from '../../../types.js';
import { TERMINOLOGY_RULES } from '../data/terminology-rules.js';
import { TERMINOLOGY_PATTERNS } from '../data/terminology-patterns.js';

function getRuleCode(incorrect: string): string {
  const l = incorrect.toLowerCase();
  if (l.includes('crypto')) return 'CT-01';
  if (l.includes('block') || l.includes('side')) return 'WC-09';
  if (l.includes('well')) return 'HY-02';
  if (l.includes('code')) return 'HY-08';
  if (l.includes('dapp')) return 'AB-07';
  if (l.startsWith('micro-')) return 'HY-10';
  if (l.startsWith('multi-')) return 'HY-12';
  if (l.includes('spin off')) return 'HY-07';
  if (l.includes('early-bird')) return 'HY-11';
  if (l.includes('-american') || l.includes('-filipino') || l.includes('-chinese')) return 'RH-01';
  return 'TERM';
}

function preserveCase(found: string, correct: string): string {
  if (found === found.toUpperCase()) return correct.toUpperCase();
  if (found === found.toLowerCase()) return correct.toLowerCase();
  if (found.charAt(0) === found.charAt(0).toUpperCase()) {
    return correct.charAt(0).toUpperCase() + correct.slice(1);
  }
  return correct;
}

export const checkTerminology: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];

  // Simple string replacement rules
  for (const incorrect in TERMINOLOGY_RULES) {
    const correct = TERMINOLOGY_RULES[incorrect];
    const escaped = incorrect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const suggestion = preserveCase(match[0], correct);
      issues.push({
        rule: 'COMMON-TERM-01',
        name: 'Terminology',
        category: 'terminology',
        severity: 'warning',
        originalText: match[0],
        suggestion,
        description: `Use "${suggestion}" instead of "${match[0]}".`,
        offset: match.index,
        length: match[0].length,
        canFix: true,
        meta: { subRule: getRuleCode(incorrect) },
      });
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
  }

  // Regex-based patterns
  for (const pattern of TERMINOLOGY_PATTERNS) {
    const fresh = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = fresh.exec(text)) !== null) {
      let suggestion = pattern.suggestion;
      if (pattern.replaceWith) {
        const result = pattern.replaceWith(match[0], match[1] ?? '', match[2] ?? '');
        if (result === null) { if (match.index === fresh.lastIndex) fresh.lastIndex++; continue; }
        suggestion = result;
      } else if (suggestion.includes('$1')) {
        suggestion = suggestion.replace('$1', match[1] || match[0]);
      }

      issues.push({
        rule: 'COMMON-TERM-01',
        name: 'Terminology',
        category: 'terminology',
        severity: 'warning',
        originalText: match[0],
        suggestion,
        description: pattern.description,
        offset: match.index,
        length: match[0].length,
        canFix: true,
        meta: { subRule: pattern.rule },
      });
      if (match.index === fresh.lastIndex) fresh.lastIndex++;
    }
  }

  issues.sort((a, b) => a.offset - b.offset);
  return issues;
};
