# stet

*"Let it stand."* — A style checker that respects the writer.

**stet** is a pluggable prose linter for newsrooms and writers. It catches style issues, flags readability problems, and suggests fixes — but you're the final boss. Flag false positives, tell it to back off, and it learns.

In an era of overzealous AI editing, stet gives you the power to push back. Your house style, your rules, your call.

## Install

```bash
npm install stet
```

## Quick start

```typescript
import { check, commonPack } from 'stet';

const issues = check('We need to utilize this tool.  It is very important.');
// → [
//   { rule: 'COMMON-COMPLEX-01', originalText: 'utilize', suggestion: 'use', ... },
//   { rule: 'COMMON-SPACE-01', originalText: '  ', suggestion: ' ', ... },
// ]
```

## CLI

```bash
npx stet check article.txt          # human-readable output
npx stet check article.txt --json   # JSON output
npx stet check article.txt -c stet.config.yaml
```

Exit code 1 if issues found (CI-friendly).

## Built-in rules (common pack)

10 rules focused on universal readability, backed by 800+ curated data entries from plain language guidelines, grammar references, and editorial review.

| Rule | What it checks | Severity |
|------|---------------|----------|
| COMMON-SENT-01 | Hard/very-hard sentences (ARI grade level) | warning |
| COMMON-ADV-01 | Adverbs (-ly), 153 exclusions | info |
| COMMON-PASSIVE-01 | Passive voice, 168 irregular participles | info |
| COMMON-COMPLEX-01 | 307 complex words with simpler alternatives | warning |
| COMMON-QUAL-01 | 54 qualifier/weakening phrases | info |
| COMMON-REDUN-01 | 118 redundant phrases ("free gift" → "gift") | info |
| COMMON-FRE-01 | Flesch Reading Ease below threshold | warning |
| COMMON-PARA-01 | Long paragraphs (>320 chars) | warning |
| COMMON-SPACE-01 | Double spaces, trailing whitespace | info |
| COMMON-REPEAT-01 | Repetitive words | warning |

House-style rules (number formatting, currency, terminology) belong in custom packs — see below.

## API

```typescript
// Tier 1: Sync, deterministic — CI, agents
check(text: string, options?: CheckOptions): Issue[]

// Tier 2: Document-level — structured sections
checkDocument(doc: DocumentInput, options?: CheckOptions): DocumentIssue[]

// Tier 3: Async — FX rates, LLM enrichment (opt-in via HostServices)
checkAsync(text: string, options?: CheckOptions): Promise<Issue[]>
checkDocumentAsync(doc: DocumentInput, options?: CheckOptions): Promise<DocumentIssue[]>
```

## Configuration

Create `stet.config.yaml`:

```yaml
packs:
  - stet/common
  - @my-org/style-rules    # your own pack

language: en-GB
roles:
  default: subeditor

config:
  freThreshold: 30
  headlineCharLimit: 90

rules:
  disable:
    - COMMON-ADV-01        # too noisy for us
```

`language` accepts `en-GB`, `en-US`, and `zh-SG`.

## Chinese spellcheck

Set `language: zh-SG` to switch `COMMON-SPELL-01` to a bundled Chinese wordlist. The extension ships `data/wordlist-zh-sg.txt`, and custom spellcheck terms are merged from `chrome.storage.sync` under `stet_custom_terms`.

Chinese support is currently dictionary-based spellcheck. The rest of the common readability pack remains English-oriented.

The extension options page also includes a `Zaobao Chinese` preset. It switches the extension to `zh-SG`, limits the common pack to `COMMON-SPELL-01`, and lets editors add newsroom-specific custom terms from the UI.

## Custom packs

```typescript
import type { RulePack } from 'stet';
import { registerPack } from 'stet';

const myPack: RulePack = {
  id: 'my-rules',
  name: 'My Style Rules',
  description: 'House style for my newsroom',
  rules: [
    {
      id: 'MY-RULE-01',
      name: 'No exclamation marks',
      category: 'style',
      severity: 'warning',
      check: (text) => {
        const issues = [];
        let idx = text.indexOf('!');
        while (idx !== -1) {
          issues.push({
            rule: 'MY-RULE-01',
            name: 'No exclamation marks',
            category: 'style',
            severity: 'warning',
            originalText: '!',
            suggestion: '.',
            description: 'Avoid exclamation marks in news copy.',
            offset: idx,
            length: 1,
            canFix: true,
          });
          idx = text.indexOf('!', idx + 1);
        }
        return issues;
      },
    },
  ],
  config: {},
};

registerPack(myPack);
```

## Roles

Built-in role presets filter rules by category:

| Role | Sees |
|------|------|
| `journalist` | House style, content accuracy |
| `subeditor` | Everything |
| `editor` | Readability, content quality |
| `online` | Quick digital publishing checks |

## Issue identity

Every issue gets:
- `issueId` — unique per run (for UI tracking)
- `fingerprint` — stable across runs (for ignore lists, analytics, feedback)

## Diagnostics

```typescript
check(text, {
  onDiagnostic: (d) => console.warn(`Rule ${d.ruleId} crashed:`, d.error),
});
```

Rule errors are reported, not swallowed.

## License

MIT
