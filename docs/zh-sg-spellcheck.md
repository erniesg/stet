# zh-SG spellcheck evidence

## What ships

- `COMMON-SPELL-01` now accepts `language: zh-SG`.
- The extension bundles `data/wordlist-zh-sg.txt` and loads it automatically when the resolved config language is `zh-SG`.
- Extension custom spellcheck entries continue to work through `chrome.storage.sync` via the `stet_custom_terms` key.
- Open pages now reload the spellcheck dictionary when saved custom terms or extension settings change in storage.
- The extension options page now includes a `Singapore Chinese` profile preset that applies `zh-SG` and limits the common pack to spellcheck.

## Dictionary provenance

- The bundled Chinese wordlist is regenerated with `npm run build:wordlist:zh-sg`.
- The build script pulls `jieba-js@1.0.2` from npm, extracts `dict/dict.txt.big`, keeps Han-only entries, and merges `data/wordlist-zh-sg-overlay.txt`.
- Upstream package metadata:
  - npm: [jieba-js](https://www.npmjs.com/package/jieba-js)
  - repository: [bluelovers/jieba-js](https://github.com/bluelovers/jieba-js)
  - package license metadata: ISC

## Singapore-specific overlay terms

The SG overlay adds terms that were missing from the upstream base list but appear in official Singapore public sources.

Transport additions include:

- `巴士转换站`
- `巴士专用道`
- `巴士道`
- `巴士车道`
- `公路电子收费`
- `双节巴士`
- `德士`
- `易通卡`
- `轻轨列车`
- `综合公交枢纽`

Housing and government-administration additions include:

- `组屋`
- `组屋区`
- `建屋局`
- `建屋发展局`
- `居民委员会`
- `居委会`
- `预购组屋`
- `人民协会`
- `人协`
- `社区发展理事会`
- `市镇理事会`
- `陆路交通管理局`
- `陆交局`
- `中央公积金局`
- `公积金局`
- `屋契回购计划`

Reference pages:

- [LTA Community Guide Safe Restart (Chinese PDF)](https://www.lta.gov.sg/content/dam/ltagov/news/press/2020/20200820_Community_Guide_Safe_Restart_Chinese.pdf)
- [HDB Speaks: Our priorities in 2024 and beyond](https://www.hdb.gov.sg/about-us/news-and-publications/publications/hdbspeaks/our-priorities-in-2024-and-beyond)
- [HDB annual reports](https://www.hdb.gov.sg/about-us/news-and-publications/publications/annual-report)
- [Singaporean Mandarin Database: bus lane](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/bus-lane)
- [Singaporean Mandarin Database: Electronic Road Pricing (ERP)](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/electronic-road-pricing-erp)
- [Singaporean Mandarin Database: ez-link card](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/ez-link-card)
- [Singaporean Mandarin Database: articulated bus / bendy bus](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/articulated-busbendy-bus)
- [Singaporean Mandarin Database: Light Rail Transit (LRT)](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/light-rail-transit-lrt)
- [Singaporean Mandarin Database: HDB estate](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/housing-development-board-hdb-estate)
- [Singaporean Mandarin Database: People's Association (PA)](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/peoples-association-pa)
- [Singaporean Mandarin Database: Community Development Council (CDC)](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/community-development-council-cdc)
- [Singaporean Mandarin Database: Residents' Committee (RC)](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/residents-committee-rc)
- [Singaporean Mandarin Database: Town Council](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/town-council)
- [Singaporean Mandarin Database: Lease Buyback Scheme](https://www.languagecouncils.sg/mandarin/ch/learning-resources/singaporean-mandarin-database/terms/lease-buyback-scheme)
- [Government Terms Translated](https://www.translatedterms.gov.sg/)
- [CPF Board Chinese Infohub page using `公积金局`](https://www.cpf.gov.sg/member/infohub/be-ready/build-my-desired-retirement-income-chinese)
- [Government Terms Translated About](https://www.translatedterms.gov.sg/about)

Notes:

- `Government Terms Translated` is useful for validating official Singapore Chinese terminology.
- `Singaporean Mandarin Database` is useful for validating Singapore-public Chinese vocabulary and common official abbreviations such as `巴士道`, `居委会`, and `人协`.
- I treated it as a reference source and manually curated a small overlay from confirmed terms instead of bulk-importing the full site dataset.

## Validation

Validated in this branch with:

- `npm run build:wordlist:zh-sg`
- `npm test -- tests/common-language-rules.test.ts tests/engine.test.ts tests/dictionary-loader.test.ts tests/extension-profiles.test.ts tests/extension-settings.test.ts`
- `npm test -- tests/checker-live-sync.test.ts`
- `npm run lint`
- `npm run build`
- `(cd packages/extension && npm run build)`
- `npx vitest run --exclude '**/crash-isolation*' --exclude 'tests/checker-safe-mode-ui.test.ts' --exclude 'tests/version-history-dom.test.ts' --exclude 'tests/checker-google-docs-overlay.test.ts'`

`npm test` still reproduces the same 3 pre-existing unrelated failures documented in `docs/zh-sg-term-bank-handoff.md`:

- `tests/checker-safe-mode-ui.test.ts`
- `tests/version-history-dom.test.ts`
- `tests/checker-google-docs-overlay.test.ts`
