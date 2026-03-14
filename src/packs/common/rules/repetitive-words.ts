import type { RuleFunction, Issue } from '../../../types.js';
import { stem } from '../../../nlp/stemmer.js';
import { COMMON_STOP_WORDS } from '../data/stop-words.js';

const BLOCK_SIZE = 130;
const THRESHOLD = 3;

let stopWordStems: Set<string> | null = null;

function getStopWordStems(): Set<string> {
  if (!stopWordStems) {
    stopWordStems = new Set(COMMON_STOP_WORDS.map(w => stem(w)));
  }
  return stopWordStems;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\b\w+\b/g) || []);
}

export const checkRepetitiveWords: RuleFunction = (text): Issue[] => {
  const issues: Issue[] = [];
  const words = tokenize(text);

  if (words.length < THRESHOLD || words.length < BLOCK_SIZE / 2) return issues;

  const stems = words.map(w => stem(w));
  const stops = getStopWordStems();
  const reported = new Set<string>();

  for (let i = 0; i <= stems.length - BLOCK_SIZE; i++) {
    const block = stems.slice(i, i + BLOCK_SIZE);
    const counts: Record<string, number> = {};

    for (const s of block) {
      if (s.length > 2 && !stops.has(s)) {
        counts[s] = (counts[s] || 0) + 1;
      }
    }

    for (const s in counts) {
      if (counts[s] >= THRESHOLD && !reported.has(s)) {
        reported.add(s);
        issues.push({
          rule: 'COMMON-REPEAT-01',
          name: 'Repetitive word',
          category: 'readability',
          severity: 'warning',
          originalText: s,
          suggestion: null,
          description: `Root "${s}" appears ${counts[s]} times in ${BLOCK_SIZE} words. Vary your vocabulary.`,
          offset: 0,
          length: 0,
          canFix: false,
          meta: { rootWord: s, count: counts[s], blockSize: BLOCK_SIZE },
        });
      }
    }
  }

  return issues;
};
