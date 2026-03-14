/** Regex-based terminology patterns. Ported from CheckerLogic.js */

export interface TerminologyPattern {
  regex: RegExp;
  suggestion: string;
  type: string;
  rule: string;
  description: string;
  replaceWith?: (match: string, ...groups: string[]) => string | null;
}

export const TERMINOLOGY_PATTERNS: TerminologyPattern[] = [
  // [PU-04] e.g./i.e. must be followed by comma
  {
    regex: /\b(e\.g\.|i\.e\.)(?!\s*,)/g,
    suggestion: '$1,',
    type: 'punctuation',
    rule: 'PU-04',
    description: 'e.g. and i.e. must be followed by a comma',
    replaceWith: (match) => match + ',',
  },

  // [CN-04] Remove comma before Inc./Ltd./LLC
  {
    regex: /,\s+(Inc|Ltd|LLC)(\.|(?=\s))/g,
    suggestion: ' $1.',
    type: 'punctuation',
    rule: 'CN-04',
    description: 'Remove comma before company suffixes',
  },

  // [HY-10] "micro-" compounds should be closed
  {
    regex: /\bmicro-([a-z]+)/g,
    suggestion: 'micro$1',
    type: 'terminology',
    rule: 'HY-10',
    description: 'Micro compounds should not be hyphenated',
    replaceWith: (match, word) => {
      const isCapital = match.charAt(0) === 'M';
      return (isCapital ? 'Micro' : 'micro') + word;
    },
  },

  // [HY-12] "multi-" compounds should be closed
  {
    regex: /\bmulti-([a-z]+)/g,
    suggestion: 'multi$1',
    type: 'terminology',
    rule: 'HY-12',
    description: 'Multi compounds should not be hyphenated',
    replaceWith: (match, word) => {
      const isCapital = match.charAt(0) === 'M';
      return (isCapital ? 'Multi' : 'multi') + word;
    },
  },

  // [AB-07] DApp / DApps casing
  {
    regex: /\b(dapps|dApps|Dapps|dapp|dApp|Dapp)\b/g,
    suggestion: 'DApp',
    type: 'terminology',
    rule: 'AB-07',
    description: 'Use correct abbreviation "DApp / DApps"',
    replaceWith: (match) => {
      const lower = match.toLowerCase();
      const isPlural = lower.endsWith('s');
      const correctForm = isPlural ? 'DApps' : 'DApp';
      return match === correctForm ? null : correctForm;
    },
  },

  // [PU-05] Place commas and periods inside closing quotation marks
  {
    regex: /(\u201D)\s*([,.])/g,
    suggestion: '',
    type: 'punctuation',
    rule: 'PU-05',
    description: 'Commas and periods go inside quotes.',
    replaceWith: (_match, quote, punctuation) => punctuation + quote,
  },

  // [HY-07] "spin-off" must stay hyphenated (noun)
  {
    regex: /\bspin\s+off(s?)\b/gi,
    suggestion: 'spin-off',
    type: 'terminology',
    rule: 'HY-07',
    description: 'Use hyphenated form "spin-off" when used as noun',
    replaceWith: (_match, plural) => 'spin-off' + plural,
  },

  // [HY-11] Remove hyphen for "early bird"
  {
    regex: /\bearly-bird\b/gi,
    suggestion: 'early bird',
    type: 'terminology',
    rule: 'HY-11',
    description: 'No hyphen needed for "early bird" when used as modifier',
    replaceWith: (match) => {
      const isCapitalized = match.charAt(0) === match.charAt(0).toUpperCase();
      return isCapitalized ? 'Early bird' : 'early bird';
    },
  },
];
