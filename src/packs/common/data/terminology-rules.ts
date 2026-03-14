/** Simple string replacement terminology rules. Ported from CheckerLogic.js */
export const TERMINOLOGY_RULES: Record<string, string> = {
  // [CT-01] Cryptocurrency as one word
  'crypto currency': 'cryptocurrency',
  'crypto coin': 'cryptocoin',

  // [WC-09] Blockchain terms as one word
  'block chain': 'blockchain',
  'side chain': 'sidechain',

  // [HY-02] Well-words hyphenation
  'well being': 'well-being',
  'well known': 'well-known',
  'well positioned': 'well-positioned',
  'well established': 'well-established',
  'well funded': 'well-funded',
  'well regarded': 'well-regarded',

  // [HY-08] No-code hyphenation
  'no code': 'no-code',
  'low code': 'low-code',

  // [RH-01] No hyphens in heritage terms
  'african-american': 'African American',
  'chinese-american': 'Chinese American',
  'korean-american': 'Korean American',
  'japanese-american': 'Japanese American',
  'vietnamese-american': 'Vietnamese American',
  'indian-american': 'Indian American',
  'mexican-american': 'Mexican American',
  'latino-american': 'Latino American',
  'asian-american': 'Asian American',
  'native-american': 'Native American',
  'chinese-filipino': 'Chinese Filipino',
  'korean-chinese': 'Korean Chinese',

  // Note: AB-07 (DApp/DApps) and HY-11 (early-bird) handled by TERMINOLOGY_PATTERNS

  // [HY-07] "spin-off" must stay hyphenated (noun)
  'spin-off': 'spin-off'
};
