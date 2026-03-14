/**
 * Syllable counter ported from SyllableCounter.js IIFE.
 * Includes an internal pluralize implementation for singular-form lookups.
 */

// ============================================================
// Pluralize internals (not exported)
// ============================================================

type PluralizeFn = {
  (word: string, count: number, inclusive?: boolean): string;
  plural: (word: string) => string;
  isPlural: (word: string) => boolean;
  singular: (word: string) => string;
  isSingular: (word: string) => boolean;
  addPluralRule: (rule: RegExp | string, replacement: string) => void;
  addSingularRule: (rule: RegExp | string, replacement: string) => void;
  addUncountableRule: (word: RegExp | string) => void;
  addIrregularRule: (single: string, plural: string) => void;
};

const pluralRules: [RegExp, string][] = [];
const singularRules: [RegExp, string][] = [];
const uncountables: Record<string, boolean> = {};
const irregularPlurals: Record<string, string> = {};
const irregularSingles: Record<string, string> = {};

function sanitizeRule(rule: RegExp | string): RegExp {
  if (typeof rule === 'string') {
    return new RegExp('^' + rule + '$', 'i');
  }
  return rule;
}

function restoreCase(word: string, token: string): string {
  if (word === token) return token;
  if (word === word.toLowerCase()) return token.toLowerCase();
  if (word === word.toUpperCase()) return token.toUpperCase();
  if (word[0] === word[0].toUpperCase()) {
    return token.charAt(0).toUpperCase() + token.substr(1).toLowerCase();
  }
  return token.toLowerCase();
}

function interpolate(str: string, args: IArguments | string[]): string {
  return str.replace(/\$(\d{1,2})/g, function (_match: string, index: string) {
    return (args as any)[index] || '';
  });
}

function replaceRule(word: string, rule: [RegExp, string]): string {
  return word.replace(rule[0], function (match: string, ...rest: any[]) {
    const args = [match, ...rest];
    const index = typeof args[args.length - 2] === 'number' ? args[args.length - 2] : 0;
    const result = interpolate(rule[1], args as any);
    if (match === '') {
      return restoreCase(word[index - 1], result);
    }
    return restoreCase(match, result);
  });
}

function sanitizeWord(
  token: string,
  word: string,
  rules: [RegExp, string][]
): string {
  if (!token.length || uncountables.hasOwnProperty(token)) {
    return word;
  }
  let len = rules.length;
  while (len--) {
    const rule = rules[len];
    if (rule[0].test(word)) return replaceRule(word, rule);
  }
  return word;
}

function replaceWord(
  replaceMap: Record<string, string>,
  keepMap: Record<string, string>,
  rules: [RegExp, string][]
): (word: string) => string {
  return function (word: string): string {
    const token = word.toLowerCase();
    if (keepMap.hasOwnProperty(token)) {
      return restoreCase(word, token);
    }
    if (replaceMap.hasOwnProperty(token)) {
      return restoreCase(word, replaceMap[token]);
    }
    return sanitizeWord(token, word, rules);
  };
}

function checkWord(
  replaceMap: Record<string, string>,
  keepMap: Record<string, string>,
  rules: [RegExp, string][]
): (word: string) => boolean {
  return function (word: string): boolean {
    const token = word.toLowerCase();
    if (keepMap.hasOwnProperty(token)) return true;
    if (replaceMap.hasOwnProperty(token)) return false;
    return sanitizeWord(token, token, rules) === token;
  };
}

const pluralize = function (
  word: string,
  count: number,
  inclusive?: boolean
): string {
  const pluralized =
    count === 1 ? pluralize.singular(word) : pluralize.plural(word);
  return (inclusive ? count + ' ' : '') + pluralized;
} as PluralizeFn;

pluralize.plural = replaceWord(irregularSingles, irregularPlurals, pluralRules);
pluralize.isPlural = checkWord(
  irregularSingles,
  irregularPlurals,
  pluralRules
);
pluralize.singular = replaceWord(
  irregularPlurals,
  irregularSingles,
  singularRules
);
pluralize.isSingular = checkWord(
  irregularPlurals,
  irregularSingles,
  singularRules
);

pluralize.addPluralRule = function (
  rule: RegExp | string,
  replacement: string
): void {
  pluralRules.push([sanitizeRule(rule), replacement]);
};
pluralize.addSingularRule = function (
  rule: RegExp | string,
  replacement: string
): void {
  singularRules.push([sanitizeRule(rule), replacement]);
};
pluralize.addUncountableRule = function (word: RegExp | string): void {
  if (typeof word === 'string') {
    uncountables[word.toLowerCase()] = true;
    return;
  }
  pluralize.addPluralRule(word, '$0');
  pluralize.addSingularRule(word, '$0');
};
pluralize.addIrregularRule = function (single: string, plural: string): void {
  plural = plural.toLowerCase();
  single = single.toLowerCase();
  irregularSingles[single] = plural;
  irregularPlurals[plural] = single;
};

// Register irregular rules
(
  [
    ['I', 'we'], ['me', 'us'], ['he', 'they'], ['she', 'they'], ['them', 'them'],
    ['myself', 'ourselves'], ['yourself', 'yourselves'], ['itself', 'themselves'],
    ['herself', 'themselves'], ['himself', 'themselves'], ['themself', 'themselves'],
    ['is', 'are'], ['was', 'were'], ['has', 'have'], ['this', 'these'], ['that', 'those'],
    ['echo', 'echoes'], ['dingo', 'dingoes'], ['volcano', 'volcanoes'],
    ['tornado', 'tornadoes'], ['torpedo', 'torpedoes'], ['genus', 'genera'],
    ['viscus', 'viscera'], ['stigma', 'stigmata'], ['stoma', 'stomata'],
    ['dogma', 'dogmata'], ['lemma', 'lemmata'], ['schema', 'schemata'],
    ['anathema', 'anathemata'], ['ox', 'oxen'], ['axe', 'axes'], ['die', 'dice'],
    ['yes', 'yeses'], ['foot', 'feet'], ['eave', 'eaves'], ['goose', 'geese'],
    ['tooth', 'teeth'], ['quiz', 'quizzes'], ['human', 'humans'], ['proof', 'proofs'],
    ['carve', 'carves'], ['valve', 'valves'], ['looey', 'looies'], ['thief', 'thieves'],
    ['groove', 'grooves'], ['pickaxe', 'pickaxes'], ['passerby', 'passersby'],
  ] as [string, string][]
).forEach(function (rule) {
  pluralize.addIrregularRule(rule[0], rule[1]);
});

// Register plural rules
(
  [
    [/s?$/i, 's'],
    [/[^\u0000-\u007F]$/i, '$0'],
    [/([^aeiou]ese)$/i, '$1'],
    [/(ax|test)is$/i, '$1es'],
    [/(alias|[^aou]us|t[lm]as|gas|ris)$/i, '$1es'],
    [/(e[mn]u)s?$/i, '$1s'],
    [/([^l]ias|[aeiou]las|[ejzr]as|[iu]am)$/i, '$1'],
    [/(alumn|syllab|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat)(?:us|i)$/i, '$1i'],
    [/(alumn|alg|vertebr)(?:a|ae)$/i, '$1ae'],
    [/(seraph|cherub)(?:im)?$/i, '$1im'],
    [/(her|at|gr)o$/i, '$1oes'],
    [/(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|automat|quor)(?:a|um)$/i, '$1a'],
    [/(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat)(?:a|on)$/i, '$1a'],
    [/sis$/i, 'ses'],
    [/(?:(kni|wi|li)fe|(ar|l|ea|eo|oa|hoo)f)$/i, '$1$2ves'],
    [/([^aeiouy]|qu)y$/i, '$1ies'],
    [/([^ch][ieo][ln])ey$/i, '$1ies'],
    [/(x|ch|ss|sh|zz)$/i, '$1es'],
    [/(matr|cod|mur|sil|vert|ind|append)(?:ix|ex)$/i, '$1ices'],
    [/\b((?:tit)?m|l)(?:ice|ouse)$/i, '$1ice'],
    [/(pe)(?:rson|ople)$/i, '$1ople'],
    [/(child)(?:ren)?$/i, '$1ren'],
    [/eaux$/i, '$0'],
    [/m[ae]n$/i, 'men'],
    ['thou', 'you'],
  ] as [RegExp | string, string][]
).forEach(function (rule) {
  pluralize.addPluralRule(rule[0], rule[1]);
});

// Register singular rules
(
  [
    [/s$/i, ''],
    [/(ss)$/i, '$1'],
    [/(wi|kni|(?:after|half|high|low|mid|non|night|[^\w]|^)li)ves$/i, '$1fe'],
    [/(ar|(?:wo|[ae])l|[eo][ao])ves$/i, '$1f'],
    [/ies$/i, 'y'],
    [/\b([pl]|zomb|(?:neck|cross)?t|coll|faer|food|gen|goon|group|lass|talk|goal|cut)ies$/i, '$1ie'],
    [/\b(mon|smil)ies$/i, '$1ey'],
    [/\b((?:tit)?m|l)ice$/i, '$1ouse'],
    [/(seraph|cherub)im$/i, '$1'],
    [/(x|ch|ss|sh|zz|tto|go|cho|alias|[^aou]us|t[lm]as|gas|(?:her|at|gr)o|[aeiou]ris)(?:es)?$/i, '$1'],
    [/(analy|diagno|parenthe|progno|synop|the|empha|cri|ne)(?:sis|ses)$/i, '$1sis'],
    [/(movie|twelve|abuse|e[mn]u)s$/i, '$1'],
    [/(test)(?:is|es)$/i, '$1is'],
    [/(alumn|syllab|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat)(?:us|i)$/i, '$1us'],
    [/(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|quor)a$/i, '$1um'],
    [/(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat)a$/i, '$1on'],
    [/(alumn|alg|vertebr)ae$/i, '$1a'],
    [/(cod|mur|sil|vert|ind)ices$/i, '$1ex'],
    [/(matr|append)ices$/i, '$1ix'],
    [/(pe)(rson|ople)$/i, '$1rson'],
    [/(child)ren$/i, '$1'],
    [/(eau)x?$/i, '$1'],
    [/men$/i, 'man'],
  ] as [RegExp | string, string][]
).forEach(function (rule) {
  pluralize.addSingularRule(rule[0], rule[1]);
});

// Register uncountable rules
(
  [
    'adulthood', 'advice', 'agenda', 'aid', 'aircraft', 'alcohol', 'ammo', 'analytics',
    'anime', 'athletics', 'audio', 'bison', 'blood', 'bream', 'buffalo', 'butter', 'carp',
    'cash', 'chassis', 'chess', 'clothing', 'cod', 'commerce', 'cooperation', 'corps',
    'debris', 'diabetes', 'digestion', 'elk', 'energy', 'equipment', 'excretion',
    'expertise', 'firmware', 'flounder', 'fun', 'gallows', 'garbage', 'graffiti',
    'hardware', 'headquarters', 'health', 'herpes', 'highjinks', 'homework',
    'housework', 'information', 'jeans', 'justice', 'kudos', 'labour', 'literature',
    'machinery', 'mackerel', 'mail', 'media', 'mews', 'moose', 'music', 'mud', 'manga',
    'news', 'only', 'personnel', 'pike', 'plankton', 'pliers', 'police', 'pollution',
    'premises', 'rain', 'research', 'rice', 'salmon', 'scissors', 'series', 'sewage',
    'shambles', 'shrimp', 'software', 'species', 'staff', 'swine', 'tennis', 'traffic',
    'transportation', 'trout', 'tuna', 'wealth', 'welfare', 'whiting', 'wildebeest',
    'wildlife', 'you',
    /pok[eé]mon$/i, /[^aeiou]ese$/i, /deer$/i, /fish$/i,
    /measles$/i, /o[iu]s$/i, /pox$/i, /sheep$/i,
  ] as (string | RegExp)[]
).forEach(pluralize.addUncountableRule);

// ============================================================
// Problematic words dictionary
// ============================================================

const problematic: Record<string, number> = {
  abalone: 4, abare: 3, abbruzzese: 4, abed: 2, aborigine: 5, abruzzese: 4, acreage: 3,
  adame: 3, adieu: 2, adobe: 3, anemone: 4, anyone: 3, apache: 3, aphrodite: 4,
  apostrophe: 4, ariadne: 4, cafe: 2, calliope: 4, catastrophe: 4, chile: 2, chloe: 2,
  circe: 2, coyote: 3, daphne: 2, epitome: 4, eurydice: 4, euterpe: 3, every: 2,
  everywhere: 3, forever: 3, gethsemane: 4, guacamole: 4, hermione: 4, hyperbole: 4,
  jesse: 2, jukebox: 2, karate: 3, machete: 3, maybe: 2, naive: 2, newlywed: 3,
  penelope: 4, people: 2, persephone: 4, phoebe: 2, pulse: 1, queue: 1, recipe: 3,
  riverbed: 3, sesame: 3, shoreline: 2, simile: 3, snuffleupagus: 5, sometimes: 2,
  syncope: 3, tamale: 3, waterbed: 3, wednesday: 2, yosemite: 4, zoe: 2,
};

// ============================================================
// Syllable regex expressions
// ============================================================

const own = {}.hasOwnProperty;

const EXPRESSION_MONOSYLLABIC_ONE = new RegExp(
  [
    'awe($|d|so)',
    'cia(?:l|$)',
    'tia',
    'cius',
    'cious',
    '[^aeiou]giu',
    '[aeiouy][^aeiouy]ion',
    'iou',
    'sia$',
    'eous$',
    '[oa]gue$',
    '.[^aeiuoycgltdb]{2,}ed$',
    '.ely$',
    '^jua',
    'uai',
    'eau',
    '^busi$',
    '(?:[aeiouy](?:' +
      [
        '[bcfgklmnprsvwxyz]',
        'ch',
        'dg',
        'g[hn]',
        'lch',
        'l[lv]',
        'mm',
        'nch',
        'n[cgn]',
        'r[bcnsv]',
        'squ',
        's[chkls]',
        'th',
      ].join('|') +
      ')ed$)',
    '(?:[aeiouy](?:' +
      [
        '[bdfklmnprstvy]',
        'ch',
        'g[hn]',
        'lch',
        'l[lv]',
        'mm',
        'nch',
        'nn',
        'r[nsv]',
        'squ',
        's[cklst]',
        'th',
      ].join('|') +
      ')es$)',
  ].join('|'),
  'g'
);

const EXPRESSION_MONOSYLLABIC_TWO = new RegExp(
  '[aeiouy](?:' +
    [
      '[bcdfgklmnprstvyz]',
      'ch',
      'dg',
      'g[hn]',
      'l[lv]',
      'mm',
      'n[cgns]',
      'r[cnsv]',
      'squ',
      's[cklst]',
      'th',
    ].join('|') +
    ')e$',
  'g'
);

const EXPRESSION_DOUBLE_SYLLABIC_ONE = new RegExp(
  '(?:' +
    [
      '([^aeiouy])\\1l',
      '[^aeiouy]ie(?:r|s?t)',
      '[aeiouym]bl',
      'eo',
      'ism',
      'asm',
      'thm',
      'dnt',
      'snt',
      'uity',
      'dea',
      'gean',
      'oa',
      'ua',
      'react?',
      'orbed',
      'shred',
      'eings?',
      '[aeiouy]sh?e[rs]',
    ].join('|') +
    ')$',
  'g'
);

const EXPRESSION_DOUBLE_SYLLABIC_TWO = new RegExp(
  [
    'creat(?!u)',
    '[^gq]ua[^auieo]',
    '[aeiou]{3}',
    '^(?:ia|mc|coa[dglx].)',
    '^re(app|es|im|us)',
    '(th|d)eist',
  ].join('|'),
  'g'
);

const EXPRESSION_DOUBLE_SYLLABIC_THREE = new RegExp(
  [
    '[^aeiou]y[ae]',
    '[^l]lien',
    'riet',
    'dien',
    'iu',
    'io',
    'ii',
    'uen',
    '[aeilotu]real',
    'real[aeilotu]',
    'iell',
    'eo[^aeiou]',
    '[aeiou]y[aeiou]',
  ].join('|'),
  'g'
);

const EXPRESSION_DOUBLE_SYLLABIC_FOUR = /[^s]ia/;

const EXPRESSION_SINGLE = new RegExp(
  [
    '^(?:' +
      [
        'un',
        'fore',
        'ware',
        'none?',
        'out',
        'post',
        'sub',
        'pre',
        'pro',
        'dis',
        'side',
        'some',
      ].join('|') +
      ')',
    '(?:(?:' +
      [
        'ly',
        'less',
        'some',
        'ful',
        'ers?',
        'ness',
        'cians?',
        'ments?',
        'ettes?',
        'villes?',
        'ships?',
        'sides?',
        'ports?',
        'shires?',
        '[gnst]ion(?:ed|s)?',
      ].join('|') +
      ')$)',
  ].join('|'),
  'g'
);

const EXPRESSION_DOUBLE = new RegExp(
  [
    '^' +
      '(?:' +
      [
        'above',
        'anti',
        'ante',
        'counter',
        'hyper',
        'afore',
        'agri',
        'infra',
        'intra',
        'inter',
        'over',
        'semi',
        'ultra',
        'under',
        'extra',
        'dia',
        'micro',
        'mega',
        'kilo',
        'pico',
        'nano',
        'macro',
        'somer',
      ].join('|') +
      ')',
    '(?:fully|berry|woman|women|edly|union|((?:[bcdfghjklmnpqrstvwxz])|[aeiou])ye?ing)$',
  ].join('|'),
  'g'
);

const EXPRESSION_TRIPLE = /(creations?|ology|ologist|onomy|onomist)$/g;

// ============================================================
// Core syllable counting functions
// ============================================================

function one(value: string): number {
  let count = 0;
  if (value.length === 0) {
    return count;
  }
  if (value.length < 3) {
    return 1;
  }
  if (own.call(problematic, value)) {
    return problematic[value];
  }

  const singular = pluralize(value, 1);
  if (own.call(problematic, singular)) {
    return problematic[singular];
  }

  const addOne = returnFactory(1);
  const subtractOne = returnFactory(-1);

  const originalValue = value;

  originalValue.replace(EXPRESSION_TRIPLE, countFactory(3) as any);
  value = value.replace(EXPRESSION_TRIPLE, '');

  originalValue.replace(EXPRESSION_DOUBLE, countFactory(2) as any);
  value = value.replace(EXPRESSION_DOUBLE, '');

  originalValue.replace(EXPRESSION_SINGLE, countFactory(1) as any);
  value = value.replace(EXPRESSION_SINGLE, '');

  const parts = value.split(/[^aeiouy]+/);
  let index = -1;
  while (++index < parts.length) {
    if (parts[index] !== '') {
      count++;
    }
  }

  originalValue.replace(EXPRESSION_MONOSYLLABIC_ONE, subtractOne as any);
  originalValue.replace(EXPRESSION_MONOSYLLABIC_TWO, subtractOne as any);
  originalValue.replace(EXPRESSION_DOUBLE_SYLLABIC_ONE, addOne as any);
  originalValue.replace(EXPRESSION_DOUBLE_SYLLABIC_TWO, addOne as any);
  originalValue.replace(EXPRESSION_DOUBLE_SYLLABIC_THREE, addOne as any);
  originalValue.replace(EXPRESSION_DOUBLE_SYLLABIC_FOUR, addOne as any);

  return count || 1;

  function countFactory(addition: number): () => string {
    return function (): string {
      count += addition;
      return '';
    };
  }

  function returnFactory(addition: number): ($0: string) => string {
    return function ($0: string): string {
      count += addition;
      return $0;
    };
  }
}

/**
 * Counts the total number of syllables in a text string.
 *
 * @param text - The text to count syllables in.
 * @returns The total syllable count.
 */
export function countSyllables(text: string): number {
  const values = String(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/['']/g, '')
    .split(/\b/g);
  let index = -1;
  let sum = 0;

  while (++index < values.length) {
    sum += one(values[index].replace(/[^a-z]/g, ''));
  }
  return sum;
}
