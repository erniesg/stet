export type DiffChunkType = 'equal' | 'insert' | 'delete';

export interface DiffChunk {
  type: DiffChunkType;
  value: string;
}

export interface DiffResult {
  chunks: DiffChunk[];
  addedChars: number;
  removedChars: number;
}

const MAX_DYNAMIC_PROGRAMMING_CELLS = 40_000;
const MAX_DYNAMIC_PROGRAMMING_TOKENS = 220;

export function diffText(currentText: string, targetText: string): DiffResult {
  const currentTokens = tokenize(currentText);
  const targetTokens = tokenize(targetText);

  let prefix = 0;
  while (
    prefix < currentTokens.length &&
    prefix < targetTokens.length &&
    currentTokens[prefix] === targetTokens[prefix]
  ) {
    prefix += 1;
  }

  let currentSuffix = currentTokens.length - 1;
  let targetSuffix = targetTokens.length - 1;
  while (
    currentSuffix >= prefix &&
    targetSuffix >= prefix &&
    currentTokens[currentSuffix] === targetTokens[targetSuffix]
  ) {
    currentSuffix -= 1;
    targetSuffix -= 1;
  }

  const chunks: DiffChunk[] = [];
  pushChunk(chunks, 'equal', currentTokens.slice(0, prefix).join(''));

  const currentMiddle = currentTokens.slice(prefix, currentSuffix + 1);
  const targetMiddle = targetTokens.slice(prefix, targetSuffix + 1);

  const middleChunks = canUseDynamicProgramming(currentMiddle, targetMiddle)
    ? diffWithDynamicProgramming(currentMiddle, targetMiddle)
    : diffAsReplacement(currentMiddle, targetMiddle);

  middleChunks.forEach((chunk) => pushChunk(chunks, chunk.type, chunk.value));
  pushChunk(chunks, 'equal', currentTokens.slice(currentSuffix + 1).join(''));

  let addedChars = 0;
  let removedChars = 0;

  for (const chunk of chunks) {
    if (chunk.type === 'insert') addedChars += chunk.value.length;
    if (chunk.type === 'delete') removedChars += chunk.value.length;
  }

  return { chunks, addedChars, removedChars };
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function canUseDynamicProgramming(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  if (left.length > MAX_DYNAMIC_PROGRAMMING_TOKENS || right.length > MAX_DYNAMIC_PROGRAMMING_TOKENS) {
    return false;
  }
  return left.length * right.length <= MAX_DYNAMIC_PROGRAMMING_CELLS;
}

function diffWithDynamicProgramming(left: string[], right: string[]): DiffChunk[] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (left[row - 1] === right[col - 1]) {
        table[row][col] = table[row - 1][col - 1] + 1;
      } else {
        table[row][col] = Math.max(table[row - 1][col], table[row][col - 1]);
      }
    }
  }

  const reversed: DiffChunk[] = [];
  let row = left.length;
  let col = right.length;

  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && left[row - 1] === right[col - 1]) {
      reversed.push({ type: 'equal', value: left[row - 1] });
      row -= 1;
      col -= 1;
      continue;
    }

    if (col > 0 && (row === 0 || table[row][col - 1] >= table[row - 1][col])) {
      reversed.push({ type: 'insert', value: right[col - 1] });
      col -= 1;
      continue;
    }

    if (row > 0) {
      reversed.push({ type: 'delete', value: left[row - 1] });
      row -= 1;
    }
  }

  return reversed.reverse().reduce<DiffChunk[]>((accumulator, chunk) => {
    pushChunk(accumulator, chunk.type, chunk.value);
    return accumulator;
  }, []);
}

function diffAsReplacement(left: string[], right: string[]): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  pushChunk(chunks, 'delete', left.join(''));
  pushChunk(chunks, 'insert', right.join(''));
  return chunks;
}

function pushChunk(chunks: DiffChunk[], type: DiffChunkType, value: string) {
  if (!value) return;

  const previous = chunks.at(-1);
  if (previous && previous.type === type) {
    previous.value += value;
    return;
  }

  chunks.push({ type, value });
}
