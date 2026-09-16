import type { Issue, RuleFunction, RulePack } from 'stet';
import { registerPack } from 'stet';

type Replacement = {
  from: string;
  to: string;
  note: string;
};

function createReplacementRule(
  ruleId: string,
  ruleName: string,
  replacements: Replacement[],
): RuleFunction {
  return (text): Issue[] => {
    const issues: Issue[] = [];

    for (const replacement of replacements) {
      const pattern = new RegExp(`\\b${escapeRegExp(replacement.from)}\\b`, 'gi');
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        issues.push({
          rule: ruleId,
          name: ruleName,
          category: 'style',
          severity: 'warning',
          originalText: match[0],
          suggestion: preserveCapitalization(match[0], replacement.to),
          description: replacement.note,
          offset: match.index,
          length: match[0].length,
          canFix: true,
        });
      }
    }

    return issues;
  };
}

export const usStylePack: RulePack = {
  id: 'example/us-style',
  name: 'Example US Style',
  description: 'Example public pack for American English spelling preferences.',
  config: { language: 'en-US' },
  rules: [
    {
      id: 'EXAMPLE-US-SPELLING-01',
      name: 'Use US spelling',
      category: 'style',
      severity: 'warning',
      check: createReplacementRule('EXAMPLE-US-SPELLING-01', 'Use US spelling', [
        { from: 'colour', to: 'color', note: 'Use American English spelling.' },
        { from: 'organise', to: 'organize', note: 'Use American English spelling.' },
        { from: 'centre', to: 'center', note: 'Use American English spelling.' },
      ]),
    },
  ],
};

export const ukStylePack: RulePack = {
  id: 'example/uk-style',
  name: 'Example UK Style',
  description: 'Example public pack for British English spelling preferences.',
  config: { language: 'en-GB' },
  rules: [
    {
      id: 'EXAMPLE-UK-SPELLING-01',
      name: 'Use UK spelling',
      category: 'style',
      severity: 'warning',
      check: createReplacementRule('EXAMPLE-UK-SPELLING-01', 'Use UK spelling', [
        { from: 'color', to: 'colour', note: 'Use British English spelling.' },
        { from: 'organize', to: 'organise', note: 'Use British English spelling.' },
        { from: 'center', to: 'centre', note: 'Use British English spelling.' },
      ]),
    },
  ],
};

export const customHouseStylePack: RulePack = {
  id: 'example/custom-house-style',
  name: 'Example Custom House Style',
  description: 'Example user-owned pack for local style rules.',
  config: {},
  rules: [
    {
      id: 'EXAMPLE-HOUSE-01',
      name: 'Avoid exclamation marks',
      category: 'style',
      severity: 'info',
      check: (text) => {
        const issues: Issue[] = [];
        let offset = text.indexOf('!');

        while (offset !== -1) {
          issues.push({
            rule: 'EXAMPLE-HOUSE-01',
            name: 'Avoid exclamation marks',
            category: 'style',
            severity: 'info',
            originalText: '!',
            suggestion: '.',
            description: 'Use a full stop in formal copy.',
            offset,
            length: 1,
            canFix: true,
          });
          offset = text.indexOf('!', offset + 1);
        }

        return issues;
      },
    },
  ],
};

export function registerExampleStylePacks() {
  registerPack(usStylePack);
  registerPack(ukStylePack);
  registerPack(customHouseStylePack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function preserveCapitalization(original: string, replacement: string): string {
  if (original.length === 0) return replacement;
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return `${replacement[0].toUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
}
