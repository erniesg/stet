# zh-SG term bank handoff

## Scope

This branch adds a first pass at Singapore Chinese spellcheck support and a small curated SG term bank on top of a larger Chinese base lexicon.

Current PR: [#4](https://github.com/erniesg/stet/pull/4)

## What landed

- `COMMON-SPELL-01` now supports `language: zh-SG`.
- Chinese spellcheck uses a bundled dictionary asset instead of browser-native spellcheck.
- The base dictionary is generated from `jieba-js@1.0.2`.
- Singapore-specific terms are layered in through `data/wordlist-zh-sg-overlay.txt`.
- The extension has a `Zaobao Chinese` profile that applies `zh-SG` and limits the common pack to spellcheck.
- Editors can add newsroom-specific accepted words in the extension options page via custom terms.

## Files that matter

- `src/packs/common/rules/spellcheck.ts`
  Language-aware spellcheck logic. English still uses Latin token matching. `zh-SG` uses Han matching against the bundled dictionary.
- `data/wordlist-zh-sg-overlay.txt`
  The curated SG term bank. This is the main file to expand deliberately.
- `data/wordlist-zh-sg.txt`
  Generated output. Do not edit manually.
- `scripts/build-zh-sg-wordlist.mjs`
  Rebuilds the generated dictionary from the upstream base plus overlay.
- `packages/extension/src/storage/profiles.ts`
  Defines `standard` and `zaobao` extension presets.
- `packages/extension/src/options/options.tsx`
  Profile picker and custom-term UI.
- `packages/extension/src/content/dictionary-loader.ts`
  Loads the language-specific bundled dictionary and custom terms.
- `docs/zh-sg-spellcheck.md`
  Evidence and source notes for the shipped overlay terms.

## Current architecture

The stack is intentionally split into three layers:

1. Base Chinese lexicon
   Source: `jieba-js@1.0.2`
   Reason: permissive package metadata, large practical wordlist, reproducible npm source.

2. Curated Singapore overlay
   Source of truth: `data/wordlist-zh-sg-overlay.txt`
   Reason: SG-specific forms are not reliably present upstream.

3. User and newsroom custom terms
   Source: `chrome.storage.sync` key `stet_custom_terms`
   Reason: lets editors extend the dictionary without code changes.

## Source policy

Use these sources differently:

- `jieba-js`
  Use as the bulk base lexicon.

- `Government Terms Translated`
  Use as a validation/reference source for official Singapore government Chinese terminology.
  Do not bulk-import the whole site into the repo unless licensing and maintenance policy are clarified.

- LTA, HDB, other official SG publications
  Use to confirm local public-facing terminology when a term is not obvious or when GTT does not cover it.

## How to expand the bank

### Add a new term

1. Confirm the term is actually useful for spellcheck.
   Good examples:
   - high-frequency local nouns
   - transport terms
   - housing/government terms
   - Zaobao newsroom vocabulary

2. Confirm the term is not already in `data/wordlist-zh-sg.txt`.

3. Validate the preferred form from a credible source.
   Preferred order:
   - Government Terms Translated
   - official SG agency pages or PDFs
   - only then, newsroom-specific internal preference if this becomes a private pack later

4. Add the term to `data/wordlist-zh-sg-overlay.txt`.

5. Rebuild the generated dictionary:

```bash
npm run build:wordlist:zh-sg
```

6. Smoke test with the built package:

```bash
node --input-type=module - <<'EOF'
import { readFileSync } from 'node:fs';
import { check, loadCommonDictionary } from './dist/index.js';
const words = readFileSync('./data/wordlist-zh-sg.txt', 'utf8').trim().split('\n');
loadCommonDictionary(words);
const issues = check('在这里放入你的中文样句。', {
  packs: ['common'],
  role: 'subeditor',
  enabledRules: ['COMMON-SPELL-01'],
  configOverrides: { language: 'zh-SG' },
});
console.log(issues);
EOF
```

7. Update `docs/zh-sg-spellcheck.md` if the new term came from a new official source or materially changes the overlay story.

## How to query Government Terms Translated

The site has a working search endpoint:

- `https://www.translatedterms.gov.sg/admin/api/Search`

It expects a normal browser-like session and AJAX headers. Example:

```python
import requests, html

s = requests.Session()
s.get('https://www.translatedterms.gov.sg/')
headers = {
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://www.translatedterms.gov.sg/',
  'Origin': 'https://www.translatedterms.gov.sg',
}

resp = s.post(
  'https://www.translatedterms.gov.sg/admin/api/Search',
  data=[
    ('Page', '1'),
    ('PageSize', '10'),
    ('LanguageFrom', '1'),  # English
    ('LanguageTo', '2'),    # Chinese
    ('SearchTerm', 'Housing & Development Board'),
  ],
  headers=headers,
)

for item in resp.json()['result']['Items']:
  zh = [
    html.unescape(t['Name'])
    for t in item.get('TransTranslations', [])
    if t.get('Language') == 2
  ]
  print(item['Name'], zh)
```

Useful language ids observed on the site:

- `1` = English
- `2` = Chinese

## What should not go into the shared overlay

Avoid adding:

- names of people
- one-off event titles
- internal shorthand
- English-only newsroom jargon unless it is truly common and repeatedly flagged
- terms that are better handled as per-user custom entries

If Zaobao eventually needs a large proprietary newsroom term set, that should probably become a separate private pack or private overlay, not more shared open-source terms.

## Good next steps

- Expand transport, housing, and government-administration vocabulary using official SG sources.
- Add a small regression test fixture that verifies a handful of SG-specific accepted terms together in one sentence.
- Consider splitting future large overlays by domain, then composing them into the generated file.
- Consider a private Zaobao-specific pack later if newsroom terminology diverges beyond general Singapore Chinese.

## Validation checklist

Run these before pushing term-bank changes:

```bash
npm run build:wordlist:zh-sg
npm test -- tests/common-language-rules.test.ts tests/engine.test.ts tests/dictionary-loader.test.ts tests/extension-profiles.test.ts tests/extension-settings.test.ts
npm run lint
(cd packages/extension && npm run build)
```

Broader regression command used on this branch:

```bash
npx vitest run --exclude '**/crash-isolation*' --exclude 'tests/checker-safe-mode-ui.test.ts' --exclude 'tests/version-history-dom.test.ts' --exclude 'tests/checker-google-docs-overlay.test.ts'
```

Those 3 excluded tests are pre-existing failures on base commit `647433a` and are unrelated to this term-bank work.
