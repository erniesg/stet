# Hammurabi + Stet — Roadmap

## The Split

Two repos, one ecosystem:

| | **stet** (open source) | **hammurabi** (private) |
|---|---|---|
| **What** | Generic prose linter framework — "ESLint for writing" | BT & TIA newsroom configs, rules, data |
| **License** | MIT | Proprietary |
| **npm** | `stet` | `@hammurabi/bt-pack`, `@hammurabi/tia-pack` |
| **Repo** | `github.com/erniesg/stet` | `github.com/erniesg/hammurabi` |
| **Who uses it** | Any newsroom, writer, CI pipeline | BT/SPH editors, TIA editors |

### Why split?

The engine, common readability rules, NLP utilities, and Chrome extension framework are **generic** — any newsroom or writer can use them. BT's 731-entry dictionary, 22 house-style rules, currency patterns, and TIA's config are **proprietary**. Open-sourcing `stet` lets others adopt and contribute while keeping newsroom IP private.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  stet  (npm package, MIT, zero deps*)                     │
│                                                           │
│  Tier 1: check(text, opts)         — sync, deterministic  │
│  Tier 2: checkDocument(doc, opts)  — structured sections   │
│  Tier 3: checkAsync(text, opts)    — FX/LLM enrichment    │
│                                                           │
│  ├── engine.ts        Core runner, dedup, sort             │
│  ├── types.ts         Issue, RulePack, CheckContext, ...   │
│  ├── roles.ts         Built-in role presets                │
│  ├── config-loader.ts stet.config.yaml parser             │
│  ├── packs/common/    13 readability rules (default public) │
│  ├── nlp/             Stemmer, syllable counter            │
│  └── feedback.ts      SuggestionFeedback type              │
│                                                           │
│  * compromise.js is an optional peer dep for POS          │
└─────────┬─────────────────────┬───────────────────────────┘
          │                     │
  ┌───────▼───────────┐  ┌─────▼──────────────────────────┐
  │  stet extension   │  │  hammurabi (private)            │
  │  (Chrome MV3)     │  │                                  │
  │  Generic UI shell │  │  @hammurabi/bt-pack              │
  │  ├─ Content script│  │  ├── 22 BT house-style rules     │
  │  ├─ Site adapters │  │  ├── 731-entry dictionary         │
  │  ├─ Annotations   │  │  ├── Currency patterns            │
  │  ├─ Popup/Options │  │  └── stet.config.yaml (BT)       │
  │  └─ Background SW │  │                                  │
  │                   │  │  @hammurabi/tia-pack              │
  │  Loads bundled    │  │  ├── TIA-specific rules (future)  │
  │  packs from       │  │  └── stet.config.yaml (TIA)      │
  │  resolved config  │  │                                  │
  └───────────────────┘  │  google_apps_script/              │
                         │  └── GAS add-on (existing)        │
                         └──────────────────────────────────┘
```

### How it connects

A newsroom creates a `stet.config.yaml`:

```yaml
# BT newsroom config (lives in hammurabi repo)
packs:
  - stet/common                    # built-in readability rules
  - @hammurabi/bt-pack             # private BT rules from npm

language: en-GB
roles:
  default: subeditor
config:
  freThreshold: 30
  headlineCharLimit: 90
  paragraphCharLimit: 320
  bodyWordLimit: 1200

dictionaries:
  - ./data/bt-dictionary.yaml

prompts:
  spelling: ./prompts/british-spelling.md
  headline: ./prompts/headline-style.md

workflows:
  postCheck: https://n8n.bt.com/webhook/style-check

feedback:
  endpoint: https://api.bt.com/style-feedback
  batchSize: 20
```

Any newsroom can create their own:

```yaml
# Example: independent magazine
packs:
  - stet/common
  - @my-mag/style-rules            # their own pack

language: en-US
config:
  freThreshold: 50
  headlineCharLimit: 70
```

### API Surface (unchanged)

```typescript
// Tier 1: Sync, deterministic — CI, agents, Apps Script
check(text: string, options?: CheckOptions): Issue[]

// Tier 2: Document-level — structured sections
checkDocument(doc: DocumentInput, options?: CheckOptions): DocumentIssue[]

// Tier 3: Async enrichment — FX, LLM (opt-in via HostServices)
checkAsync(text: string, options?: CheckOptions): Promise<Issue[]>
checkDocumentAsync(doc: DocumentInput, options?: CheckOptions): Promise<DocumentIssue[]>

// Registry
registerPack(pack: RulePack): void
getPack(id: string): RulePack | undefined
listPacks(): RulePack[]
getRole(id: string): RolePreset | undefined
listRoles(): RolePreset[]
```

### Reuse Contract

| Consumer | Uses | Provides HostServices? |
|----------|------|------------------------|
| Chrome Extension | `checkDocument()` + `checkAsync()` | Yes: FX via SW, LLM via background |
| AI agents / CPI gen | `check()` or `checkDocument()` | Optional |
| CI lint pipeline | `check()` or `checkDocument()` | No: deterministic only |
| Apps Script (sync) | `check()` | No: GAS has its own wrappers |

### Document Model

```typescript
interface DocumentInput {
  headline?: string;
  excerpt?: string;
  body: string[];
  metadata?: DocumentMetadata;
}

interface DocumentIssue extends Issue {
  section: 'headline' | 'excerpt' | 'body';
  paragraphIndex?: number;
}
```

### Host Services

```typescript
interface HostServices {
  fetchFxRate?: (from: string, to: string) => Promise<FxRateResult>;
  llmCheck?: (text: string, prompt: string) => Promise<string>;
  invokeWorkflow?: (name: string, payload: unknown) => Promise<unknown>;
  sendFeedback?: (items: SuggestionFeedback[]) => Promise<void>;
}
```

No `HostServices` → async rules don't run → deterministic.

### Rule Pack Interface

```typescript
interface RulePack {
  id: string;
  name: string;
  description: string;
  rules: RuleDefinition[];
  dictionaries?: DictionaryEntry[];
  config: PackConfig;
}
```

Third-party packs implement this interface and register via `registerPack()`.

### Stable Issue Identity ✅ Implemented

```typescript
interface Issue {
  issueId?: string;     // unique per-run occurrence ID (engine-stamped)
  fingerprint?: string; // stable FNV-1a hash of rule+text+suggestion (engine-stamped)
  rule: string;
  offset: number;
  length: number;
  originalText: string;
  suggestion: string | null;
  canFix: boolean;
}
```

`issueId` is for one concrete occurrence in one run. `fingerprint` is the durable key used for ignore lists, analytics, and feedback aggregation. Both are stamped by the engine on every issue — rules don't need to set them.

### Diagnostics Hook ✅ Implemented

```typescript
interface RuleDiagnostic {
  ruleId: string;
  packId: string;
  error: unknown;
  timestamp: string;
  phase: 'sync' | 'async';
}

// Pass via CheckOptions
check(text, { onDiagnostic: (d) => console.warn(d) });
```

Rule exceptions are now reported through the diagnostics hook instead of being silently swallowed. CI, agents, and newsroom integrations can distinguish "no issues" from "rule crashed".

### Config Loader (`stet.config.yaml`)

```typescript
interface StetConfig {
  packs: string[];              // pack IDs or npm package names
  language?: 'en-GB' | 'en-US';
  roles?: { default?: string };
  config?: Partial<PackConfig>;
  dictionaries?: string[];
  prompts?: Record<string, string>;
  workflows?: Record<string, string>;
  feedback?: {
    endpoint?: string;
    batchSize?: number;
    includeContext?: boolean;
  };
  rules?: {
    enable?: string[];          // explicit rule IDs to enable
    disable?: string[];         // explicit rule IDs to disable
  };
}

function loadConfig(path?: string): StetConfig;
```

The config loader resolves pack references:
- `stet/common` → built-in common pack
- `@hammurabi/bt-pack` → `require('@hammurabi/bt-pack')` (auto-registers)
- Relative path `./my-rules` → local pack module

### Runtime Config Modes

There are two valid config-loading modes:

- `Node / CLI / agents`: can resolve package names and relative paths at runtime.
- `Chrome extension`: cannot execute arbitrary code from YAML at runtime. It must consume either:
  - a pre-resolved JSON config generated at build time, or
  - extension options that reference already bundled / allowlisted packs.

The extension can toggle installed packs, prompts, workflow names, and feedback settings. It must not fetch and execute arbitrary npm modules from config inside MV3.

### Suggestion Feedback

```typescript
interface SuggestionFeedback {
  issueId: string;
  fingerprint: string;
  ruleId: string;
  verdict: 'correct' | 'false-positive' | 'false-negative' | 'other';
  originalText: string;
  suggestion: string | null;
  context?: string;
  action?: 'accepted' | 'dismissed' | 'ignored' | 'ignored-all';
  userComment?: string;
  timestamp: string;
}
```

Extension collects this. Newsrooms can use it to tune their packs.

---

## What's Built (current state in `hammurabi/packages/style-rules/`)

All code currently lives in this repo. The split hasn't happened yet.

### Done ✅

| Component | Status | Will move to |
|-----------|--------|-------------|
| `types.ts` — Issue (with issueId/fingerprint), RulePack, CheckContext, DocumentInput, HostServices, RuleDiagnostic, SuggestionFeedback | ✅ Complete | stet |
| `engine.ts` — check(), checkAsync(), checkDocument(), checkDocumentAsync(), registry, identity stamping, diagnostics hook | ✅ Complete | stet |
| `roles.ts` — journalist, subeditor, editor, online presets | ✅ Complete | stet |
| `index.ts` — barrel exports | ✅ Complete | stet |
| `nlp/stemmer.ts` — Porter2 stemmer | ✅ Ported from GAS | stet |
| `nlp/syllable-counter.ts` — syllable counting | ✅ Ported from GAS | stet |
| `nlp/compromise-loader.ts` — dynamic import | ✅ Complete | stet |
| `packs/common/` — 13 readability rules + 6 data files | ✅ Complete | stet |
| Stable issue identity (`issueId`, `fingerprint`) | ✅ Engine stamps FNV-1a fingerprint + unique issueId | stet |
| Diagnostics hook (`onDiagnostic`) | ✅ Rule errors reported, not swallowed | stet |
| `SuggestionFeedback` type | ✅ Type defined, ready for UI/extension integration | stet |
| Sentence-level readability (`COMMON-SENT-01`) | ✅ ARI-based hard/very-hard sentence detection | stet |
| `packs/bt/` — 22 BT rules + dict + currency data | ✅ Complete | hammurabi |
| `packs/tia/` — placeholder pack | ✅ Placeholder | hammurabi |
| Tests — 33 stet tests (engine, identity, diagnostics, sentence readability, config) | ✅ Passing | stet |
| Build — tsup ESM + CJS + DTS | ✅ Working | both |
| `config.ts` — resolveConfig(), applyUserOverrides(), toCheckOptions() | ✅ Complete | stet |
| `config-loader.ts` — loadConfig() reads stet.config.yaml from disk | ✅ Complete | stet |
| CLI — `npx stet check <file>` with --json and -c config flags | ✅ Complete | stet |
| `StetConfig` + `ResolvedStetConfig` + `UserOverrides` types | ✅ Complete | stet |
| HostServices — invokeWorkflow() + sendFeedback() added | ✅ Complete | stet |
| Extension settings — consumes ResolvedStetConfig, layers UserOverrides | ✅ Rewired | stet |
| MV3 extension build — dist/ is a loadable bundle (manifest, JS, CSS, icons) | ✅ Working | stet |
| **Repo split complete** — stet at `~/code/erniesg/stet/`, hammurabi keeps BT/TIA packs | ✅ Done | — |

### Not Done ❌

| Component | Location |
|-----------|----------|
| Feedback collection/export helpers | stet |
| Full test suite port (1,740 lines from GAS) | hammurabi |
| Golden test corpus (GAS parity) | hammurabi |
| Chrome extension framework (Phase 2+ content script wiring) | stet |
| Chrome extension UI (popup, options, onboarding) | stet |
| CUE CMS adapter | hammurabi |
| Publish `stet` to npm | stet |
| Create GitHub repo `erniesg/stet` | stet |

---

## Phase Checklist

### Phase 0: Stabilize Current Monorepo Before Split

- [x] Fix extension packaging so the build emits a loadable MV3 bundle
- [x] Add `issueId` + `fingerprint` to the core `Issue` type
- [x] Add diagnostics hook (`onDiagnostic`) — rule errors reported, not swallowed
- [x] Add `SuggestionFeedback` type for feedback collection
- [x] Add sentence-level readability rule (`COMMON-SENT-01`) — ARI-based hard/very-hard
- [x] Define `ResolvedStetConfig` + `applyUserOverrides()` + `toCheckOptions()`
- [x] Extension settings rewired to consume ResolvedStetConfig + UserOverrides
- [x] Extend HostServices with `invokeWorkflow()` + `sendFeedback()`
- [x] Repo split: `~/code/erniesg/stet/` (open source) + `~/code/erniesg/hammurabi/` (private)
- [x] Config loader: `loadConfig()` reads `stet.config.yaml`, resolves dictionaries + prompts
- [x] CLI: `npx stet check <file>` with --json and -c flags
- [x] hammurabi `packages/bt-pack/` and `packages/tia-pack/` depend on `stet` via file:
- [x] MIT license + README for stet
- [x] GitHub repo `erniesg/stet` created and pushed
- [x] BT test suite ported: 425 tests, 406 passing (95.5% parity)
- [ ] CI (GitHub Actions): lint, test, build for stet repo

### Phase 1: ~~Repo Split~~ (DONE) → Publish + CI

- [x] Create `stet/` repo locally
- [x] Create `erniesg/stet` on GitHub and push
- [ ] Claim `stet` npm package name
- [ ] CI (GitHub Actions): lint, test, build
- [ ] MIT license, README, CONTRIBUTING
- [ ] Publish `stet@0.1.0` to npm (after test parity)

### Phase 2: ~~Config Loader~~ (DONE) → Feedback + Test Parity

- [x] `stet/src/config-loader.ts` — parse `stet.config.yaml` with dictionary/prompt resolution
- [x] `SuggestionFeedback` type + `sendFeedback` in HostServices
- [x] CLI tool: `npx stet check <file>`
- [ ] `stet/src/feedback.ts` — collect/batch/export helpers
- [ ] Config loading tests (YAML parsing, pack resolution, dictionary loading)

### Phase 3: Full Test Suite

- [x] Port BT test cases (1,288 lines → 425 vitest cases, 422 passing, 3 skipped)
- [ ] Port CheckerLogic.test.js → `stet/tests/packs/common/`
- [ ] Golden test corpus: same article through GAS vs stet, diff output
- [ ] Audit all BT rules for cross-line `\s+` regex bugs
- [ ] Benchmark: < 50ms for full check on 1,200-word article
- [ ] Publish `stet@0.1.0` to npm

### Phase 4–6: Chrome Extension ← CURRENT

#### Done ✅
- [x] MV3 extension scaffold with Vite build (IIFE content script, ESM background)
- [x] Content script: discovers contenteditable, debounced recheck (800ms)
- [x] `checkDocument()` integration: splits text into headline + body paragraphs
- [x] LanguageTool-style annotation UI (solid colored underlines, card popup on click)
- [x] Suggestion chips: strikethrough original → replacement, click to apply
- [x] Ignore / Ignore All buttons (Ignore All uses fingerprint matching)
- [x] Badge count via background service worker
- [x] Popup: on/off toggle, journalist/subeditor role selector, pack display
- [x] Private pack loading: hammurabi extension build imports stet + BT pack (zero duplication)
- [x] Resolved config synced to storage so popup reflects actual packs

#### LanguageTool UX Parity

| Feature | LT | stet | Status |
|---------|-----|------|--------|
| Solid colored underlines | ✓ | ✓ | Done |
| Red=error, orange=warning, blue=style | ✓ | ✓ | Done |
| Click → card popup | ✓ | ✓ | Done |
| Suggestion chip (strikethrough → fix) | ✓ | ✓ | Done |
| Ignore / Ignore All | ✓ | ✓ | Done (not persistent) |
| Badge count | ✓ | ✓ | Done |
| Underlines visible while typing | ✓ | Reappear after 800ms | Gap — needs overlay approach |
| Persistent ignore (survives recheck) | ✓ | ✗ | Needs fingerprint storage |
| Per-rule toggle | ✓ | ✗ | Needs options page |
| Keyboard navigation (Tab/Enter) | ✓ | ✗ | Future |
| Textarea support | ✓ | ✗ | Needs overlay approach |

#### Known Bugs
- Rules using `\s+` in regexes can match across line boundaries (BT-MONTH-01 fixed, others need audit)
- Repetitive word rule (COMMON-REPEAT-01) too aggressive on domain terms
- Headline detection heuristic is fragile (first short line without period)
- Role switch requires page refresh (config not live-reloaded)

#### Remaining Work
- [ ] Persistent ignore: store fingerprints in `chrome.storage.session`, filter on recheck
- [ ] Live config reload: content script listens for storage changes
- [ ] Options page: per-rule toggles, per-category toggles
- [ ] Textarea overlay annotations
- [ ] Shadow DOM for all injected UI (avoid page CSS conflicts)
- [ ] Web Worker for rule execution (avoid blocking main thread on large documents)
- [ ] Keyboard navigation (Tab through issues, Enter to apply)
- [ ] Feedback collection (SuggestionFeedback) on accept/dismiss/ignore

### Phase 7: CUE CMS Integration (hammurabi-specific)

- [ ] Inspect CUE editor DOM (needs VPN)
- [ ] CueCmsAdapter — CUE-specific selectors, iframe handling
- [ ] Map CUE fields to sectionContext (headline, excerpt, body)
- [ ] Test all BT rules within CUE

### Phase 8: Polish + Release

- [ ] Extension icons, dark mode, accessibility (ARIA, keyboard)
- [ ] Chrome Web Store packaging (generic stet extension)
- [ ] Separate distribution for hammurabi extension (BT/TIA packs bundled)
- [ ] Documentation site for stet (how to create custom packs)

---

## Repo Structure After Split

### stet/ (open source)

```
stet/
├── src/
│   ├── index.ts                  # Public API
│   ├── engine.ts                 # Core runner
│   ├── types.ts                  # All type definitions
│   ├── roles.ts                  # Built-in role presets
│   ├── config-loader.ts          # stet.config.yaml parser
│   ├── feedback.ts               # SuggestionFeedback types
│   ├── nlp/
│   │   ├── stemmer.ts            # Porter2
│   │   ├── syllable-counter.ts
│   │   └── compromise-loader.ts
│   └── packs/
│       └── common/               # Built-in readability pack
│           ├── index.ts
│           ├── rules/            # 12 rules
│           └── data/             # Word lists
├── packages/
│   └── extension/                # Chrome extension framework
│       ├── src/
│       │   ├── background/
│       │   ├── content/
│       │   │   ├── site-adapters/
│       │   │   ├── annotation-manager.ts
│       │   │   └── text-extractor.ts
│       │   ├── popup/
│       │   ├── options/
│       │   └── onboarding/
│       └── manifest.json
├── tests/
├── bin/                          # npx stet check
├── package.json
├── tsconfig.json
├── LICENSE                       # MIT
└── README.md
```

### hammurabi/ (private, this repo)

```
hammurabi/
├── packages/
│   ├── bt-pack/                  # @hammurabi/bt-pack
│   │   ├── src/
│   │   │   ├── index.ts          # Pack definition + auto-register
│   │   │   ├── rules/            # 22 BT rules
│   │   │   └── data/             # Dict mappings, currency patterns
│   │   ├── tests/                # BT rule tests (ported from GAS)
│   │   ├── stet.config.yaml      # BT newsroom config
│   │   └── package.json          # depends on "stet"
│   ├── tia-pack/                 # @hammurabi/tia-pack
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── stet.config.yaml      # TIA newsroom config
│   │   └── package.json          # depends on "stet"
│   └── extension/                # BT/TIA Chrome extension build
│       ├── src/                  # Overrides: CUE adapter, branding
│       └── package.json          # depends on stet + bt-pack + tia-pack
├── google_apps_script/           # Existing GAS add-on
├── scripts/                      # Deployment scripts
├── package.json                  # npm workspaces
└── ROADMAP.md                    # This file
```

---

## Critical Source Files (for porting)

| File | What | Lines | Destination |
|------|------|-------|-------------|
| `google_apps_script/BTStyleChecks.js` | 22 rules + 731 dict | 2,855 | hammurabi/bt-pack ✅ done |
| `google_apps_script/CheckerLogic.js` | Readability rules | 2,164 | stet/common ✅ done |
| `google_apps_script/CurrencyConversionService.js` | FX conversion | 398 | hammurabi/bt-pack (async rule) |
| `google_apps_script/ComplexWordsData.js` | Complex words dict | 202 | stet/common ✅ done |
| `google_apps_script/PassiveVoiceData.js` | Passive voice dict | 129 | stet/common ✅ done |
| `google_apps_script/QualifiersData.js` | Qualifiers dict | 44 | stet/common ✅ done |
| `google_apps_script/Stemmer.js` | Porter2 stemmer | 369 | stet/nlp ✅ done |
| `google_apps_script/SyllableCounter.js` | Syllable counting | 586 | stet/nlp ✅ done |
| `google_apps_script/BTStyleChecks.test.js` | Test cases to port | 1,740 | hammurabi/bt-pack tests |
