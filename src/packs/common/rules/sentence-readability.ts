import type { RuleFunction, Issue } from '../../../types.js';

/**
 * Sentence-level readability — flags hard and very hard sentences.
 *
 * Uses the Automated Readability Index (ARI) per sentence.
 * ARI = 4.71 × (letters/words) + 0.5 × (words/sentences) − 21.43
 * For a single sentence, sentences=1.
 *
 * @see Senter, R.J. & Smith, E.A. (1967). "Automated Readability Index."
 *      Wright-Patterson Air Force Base. AMRL-TR-6620.
 *
 * Thresholds:
 *   - hard:     grade 11–14 (most adults find these challenging)
 *   - veryHard: grade 15+   (specialist/academic level)
 *
 * Sentences with fewer than 7 words are skipped (too short to grade reliably).
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z"'])/;
const WORD_RE = /\b\w+\b/g;
const LETTER_RE = /[a-zA-Z]/g;

const MIN_WORDS = 7;
const HARD_THRESHOLD = 11;
const VERY_HARD_THRESHOLD = 15;

function countLetters(text: string): number {
  return (text.match(LETTER_RE) || []).length;
}

function countWords(text: string): string[] {
  return text.match(WORD_RE) || [];
}

function calculateARI(letters: number, words: number): number {
  if (words === 0) return 0;
  return 4.71 * (letters / words) + 0.5 * words - 21.43;
}

export const checkSentenceReadability: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];
  const sentences = text.split(SENTENCE_SPLIT);

  let offset = 0;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    const sentenceStart = text.indexOf(trimmed, offset);
    const words = countWords(trimmed);

    if (words.length >= MIN_WORDS) {
      const letters = countLetters(trimmed);
      const ari = calculateARI(letters, words.length);
      const grade = Math.max(Math.round(ari), 0);

      if (grade >= VERY_HARD_THRESHOLD) {
        issues.push({
          rule: 'COMMON-SENT-01',
          name: 'Very hard sentence',
          category: 'readability',
          severity: 'warning',
          originalText: trimmed,
          suggestion: null,
          description: `Grade ${grade} — very hard to read. Try splitting or simplifying.`,
          offset: sentenceStart,
          length: trimmed.length,
          canFix: false,
          meta: { grade, ari: parseFloat(ari.toFixed(2)), level: 'veryHard' },
        });
      } else if (grade >= HARD_THRESHOLD) {
        issues.push({
          rule: 'COMMON-SENT-01',
          name: 'Hard sentence',
          category: 'readability',
          severity: 'info',
          originalText: trimmed,
          suggestion: null,
          description: `Grade ${grade} — hard to read. Consider simplifying.`,
          offset: sentenceStart,
          length: trimmed.length,
          canFix: false,
          meta: { grade, ari: parseFloat(ari.toFixed(2)), level: 'hard' },
        });
      }
    }

    offset = sentenceStart + trimmed.length;
  }

  return issues;
};
