import type { RulePack } from '../../types.js';
import { registerPack } from '../../engine.js';

import { checkLongParagraphs } from './rules/long-paragraphs.js';
import { checkSpacingIssues } from './rules/spacing-issues.js';
import { checkPassiveVoice } from './rules/passive-voice.js';
import { checkAdverbs } from './rules/adverbs.js';
import { checkComplexWords } from './rules/complex-words.js';
import { checkQualifiers } from './rules/qualifiers.js';
import { checkRepetitiveWords } from './rules/repetitive-words.js';
import { checkFleschReadingEase } from './rules/flesch-reading-ease.js';
import { checkSentenceReadability } from './rules/sentence-readability.js';
import { checkRedundancies } from './rules/redundancies.js';

export const commonPack: RulePack = {
  id: 'common',
  name: 'Common Readability',
  description: 'Shared readability and grammar rules that apply to all tenants.',
  config: {
    freThreshold: 30,
    paragraphCharLimit: 320,
  },
  rules: [
    {
      id: 'COMMON-PARA-01',
      name: 'Long paragraph',
      category: 'readability',
      severity: 'warning',
      check: checkLongParagraphs,
      description: 'Flags paragraphs exceeding the character limit.',
    },
    {
      id: 'COMMON-SPACE-01',
      name: 'Spacing issues',
      category: 'readability',
      severity: 'info',
      check: checkSpacingIssues,
      description: 'Flags double spaces and trailing whitespace.',
    },
    {
      id: 'COMMON-PASSIVE-01',
      name: 'Passive voice',
      category: 'readability',
      severity: 'info',
      check: checkPassiveVoice,
      description: 'Detects passive voice constructions.',
    },
    {
      id: 'COMMON-ADV-01',
      name: 'Adverb',
      category: 'readability',
      severity: 'info',
      check: checkAdverbs,
      description: 'Flags adverbs ending in -ly.',
    },
    {
      id: 'COMMON-COMPLEX-01',
      name: 'Complex word',
      category: 'readability',
      severity: 'warning',
      check: checkComplexWords,
      description: 'Suggests simpler alternatives for complex words and phrases.',
    },
    {
      id: 'COMMON-QUAL-01',
      name: 'Qualifier',
      category: 'readability',
      severity: 'info',
      check: checkQualifiers,
      description: 'Flags qualifier and weakening phrases.',
    },
    {
      id: 'COMMON-REPEAT-01',
      name: 'Repetitive word',
      category: 'readability',
      severity: 'warning',
      check: checkRepetitiveWords,
      description: 'Flags root words repeated excessively in a text block.',
    },
    {
      id: 'COMMON-FRE-01',
      name: 'Low readability',
      category: 'readability',
      severity: 'warning',
      check: checkFleschReadingEase,
      description: 'Flags text with Flesch Reading Ease below the threshold.',
    },
    {
      id: 'COMMON-SENT-01',
      name: 'Hard sentence',
      category: 'readability',
      severity: 'warning',
      check: checkSentenceReadability,
      description: 'Flags sentences that are hard or very hard to read (ARI grade level).',
    },
    {
      id: 'COMMON-REDUN-01',
      name: 'Redundant phrase',
      category: 'readability',
      severity: 'info',
      check: checkRedundancies,
      description: 'Flags redundant phrases like "free gift" or "past history".',
    },
  ],
};

// Auto-register when imported
registerPack(commonPack);
