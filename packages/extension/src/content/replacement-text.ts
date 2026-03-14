export function getReplacementText(
  text: string,
  start: number,
  originalText: string,
  suggestion: string,
): string {
  if (!suggestion) return suggestion;

  if (isAllUppercase(originalText)) {
    return suggestion.toUpperCase();
  }

  if (isSentenceStart(text, start)) {
    return capitalizeFirstLetter(suggestion);
  }

  return suggestion;
}

function isAllUppercase(value: string): boolean {
  const letters = value.match(/[A-Za-z]/g);
  if (!letters || letters.length === 0) return false;
  return letters.every((letter) => letter === letter.toUpperCase());
}

function capitalizeFirstLetter(value: string): string {
  const match = value.match(/[A-Za-z]/);
  if (!match || match.index === undefined) return value;

  const index = match.index;
  return `${value.slice(0, index)}${value.charAt(index).toUpperCase()}${value.slice(index + 1)}`;
}

function isSentenceStart(text: string, start: number): boolean {
  if (start <= 0) return true;

  let index = start - 1;
  let sawNewline = false;

  while (index >= 0) {
    const char = text[index];

    if (char === '\n') {
      sawNewline = true;
      index -= 1;
      continue;
    }

    if (/\s/.test(char) || /["'([{]/.test(char)) {
      index -= 1;
      continue;
    }

    break;
  }

  if (index < 0) return true;
  if (sawNewline) return true;

  return /[.!?]/.test(text[index]);
}
