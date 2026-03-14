import type { RuleFunction, Issue } from '../../../types.js';

const SPELLED_NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function convertNumeralToSpelled(n: string): string {
  const num = parseInt(n, 10);
  return (num >= 1 && num <= 9) ? SPELLED_NUMBERS[num - 1] : n;
}

function convertSpelledToNumeral(word: string): string {
  const idx = SPELLED_NUMBERS.indexOf(word.toLowerCase());
  return idx !== -1 ? (idx + 1).toString() : word;
}

const MEASUREMENT_UNITS = new Set([
  'km', 'kilometer', 'kilometre', 'm', 'meter', 'metre', 'cm', 'mm',
  'ft', 'foot', 'feet', 'inch', 'inches', 'mile', 'miles',
  'kg', 'kilogram', 'g', 'gram', 'lb', 'pound', 'oz', 'ounce',
  'l', 'liter', 'litre', 'ml', 'hectare', 'sqm', 'sqft',
  'second', 'seconds', 'minute', 'minutes', 'hour', 'hours',
  'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'dollar', 'dollars', 'baht', 'euro', 'euros', 'yen', 'pound', 'pounds',
  'ringgit', 'rupiah', 'rupee', 'rupees', 'yuan', 'won',
]);

/** Body: spell out 1-9 */
function checkBodyNumbers(text: string): Issue[] {
  const issues: Issue[] = [];
  const pattern = /\b([1-9])(?![\d]|st|nd|rd|th|%|,|\$|\u20AC|\u00A3|\u00A5|\u20B9|\.[\d])\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const numeral = match[1];
    const start = match.index;
    const before = start > 0 ? text.charAt(start - 1) : '';
    const after = start + numeral.length < text.length ? text.charAt(start + numeral.length) : '';

    // Skip currency, decimals, years
    if (/[\$\u20AC\u00A3\u00A5\u20B9]/.test(before) || after === '%') continue;
    if (after === '.' || before === '.') continue;
    if (/[12]/.test(before)) continue;

    // Skip growth multiples
    const afterCtx = text.substring(start + numeral.length, Math.min(text.length, start + numeral.length + 20));
    if (/^\s*times\b/i.test(afterCtx) || /^\s*fold\b/i.test(afterCtx)) continue;
    if (/^\s+percent\b/i.test(afterCtx) || /^\s+per\s+cent\b/i.test(afterCtx)) continue;

    // Skip measurements
    const nextWord = text.substring(start + numeral.length).trim().split(/\s+/)[0]?.replace(/[.,;:!?)]*$/, '') ?? '';
    if (MEASUREMENT_UNITS.has(nextWord.toLowerCase())) continue;

    issues.push({
      rule: 'COMMON-NUMSTYLE-01',
      name: 'Spell out number',
      category: 'numbers',
      severity: 'warning',
      originalText: numeral,
      suggestion: convertNumeralToSpelled(numeral),
      description: `In body text, spell out numbers 1-9. Use "${convertNumeralToSpelled(numeral)}".`,
      offset: start,
      length: numeral.length,
      canFix: true,
    });

    if (match.index === pattern.lastIndex) pattern.lastIndex++;
  }

  return issues;
}

/** Headlines: use numerals, flag spelled-out numbers */
function checkHeadlineNumbers(text: string): Issue[] {
  const issues: Issue[] = [];
  const spelledPattern = new RegExp(`\\b(${SPELLED_NUMBERS.join('|')})\\b`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = spelledPattern.exec(text)) !== null) {
    const word = match[1];
    const start = match.index;

    // Skip awkward contexts ("one of the", "one or two")
    const before = text.substring(Math.max(0, start - 10), start);
    const after = text.substring(start + word.length, Math.min(text.length, start + word.length + 10));
    if (/\bof\s+the\s*$/i.test(before) || /^\s+of\s+the\b/i.test(after)) continue;
    if (/^\s+or\s+/i.test(after)) continue;

    issues.push({
      rule: 'COMMON-NUMSTYLE-01',
      name: 'Use numeral in headline',
      category: 'numbers',
      severity: 'warning',
      originalText: word,
      suggestion: convertSpelledToNumeral(word),
      description: `In headlines, use numerals. Use "${convertSpelledToNumeral(word)}".`,
      offset: start,
      length: word.length,
      canFix: true,
    });

    if (match.index === spelledPattern.lastIndex) spelledPattern.lastIndex++;
  }

  return issues;
}

export const checkNumberStyle: RuleFunction = (text, ctx): Issue[] => {
  if (ctx.sectionContext === 'headline') {
    return checkHeadlineNumbers(text);
  }
  return checkBodyNumbers(text);
};
