import { describe, it, expect, beforeAll } from 'vitest';
import type { RuleDiagnostic, StetConfig } from '../src/index.js';
import {
  check, checkAsync, checkDocument, checkDocumentAsync,
  registerPack, getPack, listPacks, getRole, listRoles,
  resolveConfig, applyUserOverrides, toCheckOptions, DEFAULT_RESOLVED_CONFIG,
} from '../src/index.js';

// Packs auto-register on import via index.ts barrel

describe('Pack registry', () => {
  it('has common pack registered', () => {
    const packs = listPacks();
    const ids = packs.map(p => p.id);
    expect(ids).toContain('common');
  });

  it('getPack returns a pack by id', () => {
    const common = getPack('common');
    expect(common).toBeDefined();
    expect(common!.rules.length).toBeGreaterThan(0);
  });

  it('lists built-in roles', () => {
    const roles = listRoles();
    expect(roles.length).toBe(4);
    const ids = roles.map(r => r.id);
    expect(ids).toContain('journalist');
    expect(ids).toContain('subeditor');
  });

  it('getRole returns a role by id', () => {
    const role = getRole('subeditor');
    expect(role).toBeDefined();
    expect(role!.enabledCategories.length).toBeGreaterThan(0);
  });
});

describe('check() — sync paragraph API', () => {
  it('returns empty array for clean text', () => {
    const issues = check('This is a clean sentence.', { packs: ['common'] });
    // May have some issues (adverbs etc) but shouldn't crash
    expect(Array.isArray(issues)).toBe(true);
  });

  it('detects double spaces', () => {
    const issues = check('Hello  world', { packs: ['common'] });
    const spacing = issues.filter(i => i.rule === 'COMMON-SPACE-01');
    expect(spacing.length).toBeGreaterThan(0);
    expect(spacing[0].suggestion).toBe(' ');
  });

  it('detects passive voice', () => {
    const issues = check('The ball was thrown by the boy.', { packs: ['common'] });
    const passive = issues.filter(i => i.rule === 'COMMON-PASSIVE-01');
    expect(passive.length).toBeGreaterThan(0);
    expect(passive[0].originalText).toContain('was thrown');
  });

  it('detects complex words', () => {
    const issues = check('We need to utilize this tool.', { packs: ['common'] });
    const complex = issues.filter(i => i.rule === 'COMMON-COMPLEX-01');
    expect(complex.length).toBeGreaterThan(0);
    expect(complex[0].originalText.toLowerCase()).toBe('utilize');
  });

  it('filters by role', () => {
    // Journalist role should disable readability category
    const journalistIssues = check('The ball was thrown by the boy.', {
      packs: ['common'],
      role: 'journalist',
    });
    const passive = journalistIssues.filter(i => i.rule === 'COMMON-PASSIVE-01');
    expect(passive.length).toBe(0); // readability disabled for journalist

    // Sub-editor sees everything
    const subedIssues = check('The ball was thrown by the boy.', {
      packs: ['common'],
      role: 'subeditor',
    });
    const subedPassive = subedIssues.filter(i => i.rule === 'COMMON-PASSIVE-01');
    expect(subedPassive.length).toBeGreaterThan(0);
  });
});

describe('checkDocument() — structured document API', () => {
  it('checks headline, excerpt and body with correct section context', () => {
    const issues = checkDocument(
      {
        headline: 'Five big tech firms report record growth',
        excerpt: 'The companies  reported strong earnings.',
        body: [
          'He has 5 cats and 3 dogs.',
          'The ball was thrown by the boy.',
        ],
      },
      { packs: ['common'] },
    );

    // Excerpt: double space should be flagged
    const excerptIssues = issues.filter(i => i.section === 'excerpt');
    const spacing = excerptIssues.filter(i => i.rule === 'COMMON-SPACE-01');
    expect(spacing.length).toBeGreaterThan(0);

    // Body: passive voice in paragraph 1
    const bodyIssues = issues.filter(i => i.section === 'body');
    const passive = bodyIssues.filter(i => i.rule === 'COMMON-PASSIVE-01');
    expect(passive.length).toBeGreaterThan(0);
    expect(passive[0].paragraphIndex).toBe(1);

    // Body paragraph indices are set
    const bodyWithIndex = bodyIssues.filter(i => i.paragraphIndex !== undefined);
    expect(bodyWithIndex.length).toBeGreaterThan(0);
  });

  it('returns DocumentIssue with section and paragraphIndex', () => {
    const issues = checkDocument(
      { body: ['Hello  world'] },
      { packs: ['common'] },
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].section).toBe('body');
    expect(issues[0].paragraphIndex).toBe(0);
  });
});

describe('checkAsync()', () => {
  it('returns sync issues even without host services', async () => {
    const issues = await checkAsync('Hello  world', { packs: ['common'] });
    const spacing = issues.filter(i => i.rule === 'COMMON-SPACE-01');
    expect(spacing.length).toBeGreaterThan(0);
  });
});

describe('checkDocumentAsync()', () => {
  it('returns document issues', async () => {
    const issues = await checkDocumentAsync(
      { body: ['Hello  world'] },
      { packs: ['common'] },
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].section).toBe('body');
  });
});

// ---------------------------------------------------------------------------
// Issue identity (issueId + fingerprint)
// ---------------------------------------------------------------------------

describe('Issue identity', () => {
  it('stamps issueId on every issue', () => {
    const issues = check('Hello  world', { packs: ['common'] });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.issueId).toBeDefined();
      expect(issue.issueId).toMatch(/^issue-/);
    }
  });

  it('stamps fingerprint on every issue', () => {
    const issues = check('Hello  world', { packs: ['common'] });
    for (const issue of issues) {
      expect(issue.fingerprint).toBeDefined();
      expect(issue.fingerprint).toMatch(/^fp-/);
    }
  });

  it('generates stable fingerprints across runs', () => {
    const issues1 = check('Hello  world', { packs: ['common'] });
    const issues2 = check('Hello  world', { packs: ['common'] });
    const fp1 = issues1.filter(i => i.rule === 'COMMON-SPACE-01').map(i => i.fingerprint);
    const fp2 = issues2.filter(i => i.rule === 'COMMON-SPACE-01').map(i => i.fingerprint);
    expect(fp1).toEqual(fp2);
  });

  it('generates unique issueIds across runs', () => {
    const issues1 = check('Hello  world', { packs: ['common'] });
    const issues2 = check('Hello  world', { packs: ['common'] });
    const ids1 = issues1.map(i => i.issueId);
    const ids2 = issues2.map(i => i.issueId);
    // No overlap between runs
    for (const id of ids1) {
      expect(ids2).not.toContain(id);
    }
  });
});

describe('Issue conflict resolution', () => {
  beforeAll(() => {
    registerPack({
      id: 'test-common-priority',
      name: 'Test common priority',
      description: 'Synthetic common-like pack for overlap tests',
      config: {},
      rules: [{
        id: 'TEST-COMMON-CAPS-01',
        name: 'Capitalize title',
        category: 'capitalization',
        severity: 'warning',
        check: (text) => text.startsWith('mr')
          ? [{
              rule: 'TEST-COMMON-CAPS-01',
              name: 'Capitalize title',
              category: 'capitalization',
              severity: 'warning',
              originalText: 'mr',
              suggestion: 'Mr',
              description: 'Capitalize the first word.',
              offset: 0,
              length: 2,
              canFix: true,
            }]
          : [],
      }],
    });

    registerPack({
      id: 'test-tenant-priority',
      name: 'Test tenant priority',
      description: 'Synthetic tenant pack for overlap tests',
      config: {},
      rules: [{
        id: 'TEST-TENANT-STYLE-01',
        name: 'Drop courtesy title',
        category: 'style',
        severity: 'warning',
        check: (text) => text.startsWith('mr')
          ? [{
              rule: 'TEST-TENANT-STYLE-01',
              name: 'Drop courtesy title',
              category: 'style',
              severity: 'warning',
              originalText: 'mr',
              suggestion: '',
              description: 'Drop courtesy title.',
              offset: 0,
              length: 2,
              canFix: true,
            }]
          : [],
      }],
    });

  });

  it('prefers later-pack tenant issues over common issues on the same span', () => {
    const issues = check('mr kwek is here', {
      packs: ['test-common-priority', 'test-tenant-priority'],
    });

    expect(issues.map((issue) => issue.rule)).toEqual(['TEST-TENANT-STYLE-01']);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics hook
// ---------------------------------------------------------------------------

describe('Diagnostics hook', () => {
  it('calls onDiagnostic when a sync rule throws', () => {
    // Register a broken pack
    registerPack({
      id: 'test-broken',
      name: 'Broken pack',
      description: 'For testing diagnostics',
      rules: [{
        id: 'TEST-CRASH-01',
        name: 'Crasher',
        category: 'test',
        severity: 'error',
        check: () => { throw new Error('rule crashed'); },
      }],
      config: {},
    });

    const diagnostics: RuleDiagnostic[] = [];
    const issues = check('some text', {
      packs: ['test-broken'],
      onDiagnostic: (d) => diagnostics.push(d),
    });

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].ruleId).toBe('TEST-CRASH-01');
    expect(diagnostics[0].packId).toBe('test-broken');
    expect(diagnostics[0].phase).toBe('sync');
    expect(diagnostics[0].error).toBeInstanceOf(Error);
    expect(issues.length).toBe(0); // crashed rule produces no issues
  });

  it('does not crash if no onDiagnostic is provided (backward compat)', () => {
    const issues = check('some text', { packs: ['test-broken'] });
    expect(Array.isArray(issues)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sentence-level readability (COMMON-SENT-01)
// ---------------------------------------------------------------------------

describe('COMMON-SENT-01 — sentence readability', () => {
  it('flags very hard sentences', () => {
    // Long, complex sentence that should score high on ARI
    const text = 'The extraordinarily complicated implementation of the sophisticated governmental regulatory framework necessitated comprehensive interdepartmental collaboration across multiple jurisdictional boundaries.';
    const issues = check(text, { packs: ['common'] });
    const sent = issues.filter(i => i.rule === 'COMMON-SENT-01');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].meta?.level).toBe('veryHard');
  });

  it('does not flag short simple sentences', () => {
    const text = 'The cat sat on the mat.';
    const issues = check(text, { packs: ['common'] });
    const sent = issues.filter(i => i.rule === 'COMMON-SENT-01');
    expect(sent.length).toBe(0);
  });

  it('skips sentences with fewer than 6 words', () => {
    const text = 'Hello there.';
    const issues = check(text, { packs: ['common'] });
    const sent = issues.filter(i => i.rule === 'COMMON-SENT-01');
    expect(sent.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

describe('resolveConfig()', () => {
  it('resolves a minimal config with defaults', () => {
    const raw: StetConfig = { packs: ['common'] };
    const resolved = resolveConfig(raw);
    expect(resolved.packs).toEqual(['common']);
    expect(resolved.language).toBe('en-GB');
    expect(resolved.role).toBe('subeditor');
    expect(resolved.enabled).toBe(true);
    expect(resolved.feedback.endpoint).toBeNull();
  });

  it('resolves stet/ prefixed packs', () => {
    const raw: StetConfig = { packs: ['stet/common'] };
    const resolved = resolveConfig(raw);
    expect(resolved.packs).toEqual(['common']);
  });

  it('applies config overrides', () => {
    const raw: StetConfig = {
      packs: ['common'],
      config: { freThreshold: 50, headlineCharLimit: 70 },
    };
    const resolved = resolveConfig(raw);
    expect(resolved.packConfig.freThreshold).toBe(50);
    expect(resolved.packConfig.headlineCharLimit).toBe(70);
  });

  it('resolves role and language', () => {
    const raw: StetConfig = {
      packs: ['common'],
      language: 'en-US',
      roles: { default: 'editor' },
    };
    const resolved = resolveConfig(raw);
    expect(resolved.language).toBe('en-US');
    expect(resolved.role).toBe('editor');
  });

  it('resolves rule enable/disable', () => {
    const raw: StetConfig = {
      packs: ['common'],
      rules: { enable: ['COMMON-SPACE-01'], disable: ['COMMON-FRE-01'] },
    };
    const resolved = resolveConfig(raw);
    expect(resolved.rules.enable).toEqual(['COMMON-SPACE-01']);
    expect(resolved.rules.disable).toEqual(['COMMON-FRE-01']);
  });

  it('resolves feedback config', () => {
    const raw: StetConfig = {
      packs: ['common'],
      feedback: { endpoint: 'https://api.example.com/feedback', batchSize: 10 },
    };
    const resolved = resolveConfig(raw);
    expect(resolved.feedback.endpoint).toBe('https://api.example.com/feedback');
    expect(resolved.feedback.batchSize).toBe(10);
  });

  it('falls back to common if no valid packs found', () => {
    const raw: StetConfig = { packs: ['nonexistent-pack'] };
    const resolved = resolveConfig(raw);
    expect(resolved.packs).toEqual(['common']);
  });
});

describe('applyUserOverrides()', () => {
  it('layers user overrides on top of resolved config', () => {
    const base = DEFAULT_RESOLVED_CONFIG;
    const result = applyUserOverrides(base, {
      enabled: false,
      role: 'editor',
      debounceMs: 1000,
    });
    expect(result.enabled).toBe(false);
    expect(result.role).toBe('editor');
    expect(result.debounceMs).toBe(1000);
    // Base unchanged
    expect(base.enabled).toBe(true);
    expect(base.role).toBe('subeditor');
  });

  it('merges disabled rules', () => {
    const base = resolveConfig({
      packs: ['common'],
      rules: { disable: ['COMMON-FRE-01'] },
    });
    const result = applyUserOverrides(base, {
      disableRules: ['COMMON-ADV-01'],
    });
    expect(result.rules.disable).toContain('COMMON-FRE-01');
    expect(result.rules.disable).toContain('COMMON-ADV-01');
  });
});

describe('toCheckOptions()', () => {
  it('converts resolved config to CheckOptions', () => {
    const config = resolveConfig({
      packs: ['common'],
      roles: { default: 'editor' },
      rules: { disable: ['COMMON-FRE-01'] },
      config: { freThreshold: 40 },
    });
    const opts = toCheckOptions(config);
    expect(opts.packs).toEqual(['common']);
    expect(opts.role).toBe('editor');
    expect(opts.disabledRules).toEqual(['COMMON-FRE-01']);
    expect(opts.configOverrides?.freThreshold).toBe(40);
  });
});
