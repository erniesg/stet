# zh-SG spellcheck evidence

## What ships

- `COMMON-SPELL-01` now accepts `language: zh-SG`.
- The extension bundles `data/wordlist-zh-sg.txt` and loads it automatically when the resolved config language is `zh-SG`.
- Extension custom spellcheck entries continue to work through `chrome.storage.sync` via the `stet_custom_terms` key.

## Dictionary provenance

- The bundled Chinese wordlist is regenerated with `npm run build:wordlist:zh-sg`.
- The build script pulls `jieba-js@1.0.2` from npm, extracts `dict/dict.txt.big`, keeps Han-only entries, and merges `data/wordlist-zh-sg-overlay.txt`.
- Upstream package metadata:
  - npm: [jieba-js](https://www.npmjs.com/package/jieba-js)
  - repository: [bluelovers/jieba-js](https://github.com/bluelovers/jieba-js)
  - package license metadata: ISC

## Singapore-specific overlay terms

The SG overlay adds terms that were missing from the upstream base list but appear in official Singapore sources:

- `巴士转换站`
- `德士`
- `组屋`
- `建屋局`

Reference pages:

- [LTA Community Guide Safe Restart (Chinese PDF)](https://www.lta.gov.sg/content/dam/ltagov/news/press/2020/20200820_Community_Guide_Safe_Restart_Chinese.pdf)
- [HDB Speaks: Our priorities in 2024 and beyond](https://www.hdb.gov.sg/about-us/news-and-publications/publications/hdbspeaks/our-priorities-in-2024-and-beyond)
- [HDB annual reports](https://www.hdb.gov.sg/about-us/news-and-publications/publications/annual-report)

## Validation

Validated in this branch with:

- `npm run build:wordlist:zh-sg`
- `npm test -- tests/common-language-rules.test.ts tests/engine.test.ts tests/dictionary-loader.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `(cd packages/extension && npm run build)`
