import type { RuleFunction, Issue } from '../../../types.js';
import { countSyllables } from '../../../nlp/syllable-counter.js';

const MINIMUM_WORDS = 30;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\b\w+\b/g) || []);
}

function calculateFRE(text: string): number | null {
  const words = tokenize(text);
  if (words.length === 0) return null;

  let totalSyllables = 0;
  for (const w of words) totalSyllables += countSyllables(w);

  const sentences = text.match(/[^.!?]+[.!?](?!\s*[a-z0-9])/gi) || [];
  const totalSentences = sentences.length > 0 ? sentences.length : 1;

  const asl = words.length / totalSentences;
  const asw = totalSyllables / words.length;
  const score = 206.835 - 1.015 * asl - 84.6 * asw;

  return parseFloat(score.toFixed(2));
}

export const checkFleschReadingEase: RuleFunction = (text, ctx): Issue[] => {
  const words = tokenize(text);
  if (words.length < MINIMUM_WORDS) return [];

  const score = calculateFRE(text);
  const threshold = ctx.packConfig.freThreshold ?? 30;

  if (score !== null && score < threshold) {
    return [{
      rule: 'COMMON-FRE-01',
      name: 'Low readability',
      category: 'readability',
      severity: 'warning',
      originalText: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
      suggestion: null,
      description: `Flesch Reading Ease: ${score} (minimum: ${threshold}). Simplify sentences or use shorter words.`,
      offset: 0,
      length: text.length,
      canFix: false,
      meta: { score, threshold },
    }];
  }

  return [];
};
