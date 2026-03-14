import type {
  Issue, CheckOptions, CheckContext, RulePack, RuleDefinition,
  RolePreset, PackConfig, DocumentInput, DocumentIssue, HostServices,
  DiagnosticsHook, RuleDiagnostic,
} from './types.js';
import { builtInRoles } from './roles.js';

// ---------------------------------------------------------------------------
// Issue identity helpers
// ---------------------------------------------------------------------------

let issueCounter = 0;

/** Generate a unique issueId for a single run occurrence */
function generateIssueId(): string {
  return `issue-${Date.now()}-${++issueCounter}`;
}

/**
 * Generate a stable fingerprint from rule + originalText + suggestion.
 * Same flagged text with the same rule produces the same fingerprint
 * across reruns, consumers, and environments.
 */
function generateFingerprint(rule: string, originalText: string, suggestion: string | null): string {
  const input = `${rule}|${originalText}|${suggestion ?? ''}`;
  // Simple FNV-1a 32-bit hash — fast, deterministic, no deps
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `fp-${hash.toString(36)}`;
}

/** Stamp issueId + fingerprint onto an issue that rules returned without them */
function stampIdentity(issue: Issue): Issue {
  if (!issue.issueId) {
    issue.issueId = generateIssueId();
  }
  if (!issue.fingerprint) {
    issue.fingerprint = generateFingerprint(issue.rule, issue.originalText, issue.suggestion);
  }
  return issue;
}

/** Registry of all loaded packs */
const packRegistry = new Map<string, RulePack>();

/** Register a rule pack */
export function registerPack(pack: RulePack): void {
  packRegistry.set(pack.id, pack);
}

/** Get a registered pack by ID */
export function getPack(id: string): RulePack | undefined {
  return packRegistry.get(id);
}

/** List all registered packs */
export function listPacks(): RulePack[] {
  return Array.from(packRegistry.values());
}

/** Get a built-in role by ID */
export function getRole(id: string): RolePreset | undefined {
  return builtInRoles.find(r => r.id === id);
}

/** List all built-in roles */
export function listRoles(): RolePreset[] {
  return [...builtInRoles];
}

/** Get all rules for a given pack */
export function getRulesForPack(packId: string): RuleDefinition[] {
  const pack = packRegistry.get(packId);
  return pack ? pack.rules : [];
}

/** Find which pack a rule belongs to */
function findPackForRule(ruleId: string): string | undefined {
  for (const [packId, pack] of packRegistry) {
    if (pack.rules.some(r => r.id === ruleId)) return packId;
  }
  return undefined;
}

/** Run a single rule against text */
export function runRule(ruleId: string, text: string, ctx: CheckContext): Issue[] {
  for (const pack of packRegistry.values()) {
    const rule = pack.rules.find(r => r.id === ruleId);
    if (rule) {
      return rule.check(text, ctx);
    }
  }
  return [];
}

/** Merge pack configs, with overrides taking precedence */
function mergeConfigs(packs: RulePack[], overrides?: Partial<PackConfig>): PackConfig {
  const merged: PackConfig = {};
  for (const pack of packs) {
    Object.assign(merged, pack.config);
  }
  if (overrides) {
    Object.assign(merged, overrides);
  }
  return merged;
}

/** Filter rules by role and explicit enable/disable lists */
function filterRules(
  rules: RuleDefinition[],
  role?: RolePreset,
  enabledRules?: string[],
  disabledRules?: string[],
): RuleDefinition[] {
  let filtered = rules;

  // Apply role category filtering
  if (role) {
    filtered = filtered.filter(r => {
      if (role.disabledCategories.includes(r.category)) return false;
      if (role.enabledCategories.length > 0) {
        return role.enabledCategories.includes(r.category);
      }
      return true;
    });
  }

  // Apply explicit rule lists
  if (enabledRules && enabledRules.length > 0) {
    filtered = filtered.filter(r => enabledRules.includes(r.id));
  }
  if (disabledRules && disabledRules.length > 0) {
    filtered = filtered.filter(r => !disabledRules.includes(r.id));
  }

  return filtered;
}

/** Deduplicate issues: rule-based wins over LLM for same originalText+suggestion */
function deduplicateIssues(issues: Issue[]): Issue[] {
  const ruleBasedKeys = new Set<string>();

  // First pass: index rule-based issues
  for (const issue of issues) {
    if (!issue.rule.includes('-LLM') && issue.originalText) {
      const key = `${issue.originalText.toLowerCase()}|${(issue.suggestion || '').toLowerCase()}`;
      ruleBasedKeys.add(key);
    }
  }

  // Second pass: drop LLM issues that duplicate a rule-based finding
  return issues.filter(issue => {
    if (issue.rule.includes('-LLM') && issue.originalText) {
      const key = `${issue.originalText.toLowerCase()}|${(issue.suggestion || '').toLowerCase()}`;
      if (ruleBasedKeys.has(key)) return false;
    }
    return true;
  });
}

/**
 * Main entry point: check text against active rule packs.
 * Returns issues sorted by offset.
 */
export function check(text: string, options?: CheckOptions): Issue[] {
  const opts = options || {};

  // Determine active packs
  const activePackIds = opts.packs || Array.from(packRegistry.keys());
  const activePacks = activePackIds
    .map(id => packRegistry.get(id))
    .filter((p): p is RulePack => p !== undefined);

  if (activePacks.length === 0) return [];

  // Merge config
  const packConfig = mergeConfigs(activePacks, opts.configOverrides);

  // Build context
  const ctx: CheckContext = {
    sectionContext: opts.sectionContext || 'body',
    fullDocumentText: opts.fullDocumentText || text,
    activePacks: activePackIds,
    activeRole: opts.role || 'subeditor',
    packConfig,
    host: opts.host,
  };

  // Get role
  const role = opts.role ? getRole(opts.role) : undefined;

  // Collect all rules from active packs
  let allRules: RuleDefinition[] = [];
  for (const pack of activePacks) {
    allRules = allRules.concat(pack.rules);
  }

  // Filter by role and explicit lists
  const activeRules = filterRules(allRules, role, opts.enabledRules, opts.disabledRules);

  // Run all sync rules
  let issues: Issue[] = [];
  for (const rule of activeRules) {
    if (!rule.isAsync) {
      try {
        const ruleIssues = rule.check(text, ctx);
        issues = issues.concat(ruleIssues);
      } catch (err) {
        // Report via diagnostics hook instead of silently swallowing
        if (opts.onDiagnostic) {
          const packId = findPackForRule(rule.id) || 'unknown';
          opts.onDiagnostic({
            ruleId: rule.id,
            packId,
            error: err,
            timestamp: new Date().toISOString(),
            phase: 'sync',
          });
        }
      }
    }
  }

  // Stamp identity on all issues
  issues = issues.map(stampIdentity);

  // Deduplicate and sort by offset
  issues = deduplicateIssues(issues);
  issues.sort((a, b) => a.offset - b.offset);

  return issues;
}

/**
 * Async entry point: check text including async rules (API calls, LLM).
 * Pass `options.host` to provide HostServices (FX rates, LLM) for async rules.
 */
export async function checkAsync(text: string, options?: CheckOptions): Promise<Issue[]> {
  // First run sync rules
  const syncIssues = check(text, options);

  const opts = options || {};
  const activePackIds = opts.packs || Array.from(packRegistry.keys());
  const activePacks = activePackIds
    .map(id => packRegistry.get(id))
    .filter((p): p is RulePack => p !== undefined);

  const packConfig = mergeConfigs(activePacks, opts.configOverrides);
  const ctx: CheckContext = {
    sectionContext: opts.sectionContext || 'body',
    fullDocumentText: opts.fullDocumentText || text,
    activePacks: activePackIds,
    activeRole: opts.role || 'subeditor',
    packConfig,
    host: opts.host,
  };

  const role = opts.role ? getRole(opts.role) : undefined;
  let allRules: RuleDefinition[] = [];
  for (const pack of activePacks) {
    allRules = allRules.concat(pack.rules);
  }
  const activeRules = filterRules(allRules, role, opts.enabledRules, opts.disabledRules);

  // Run async rules
  const asyncResults = await Promise.all(
    activeRules
      .filter(r => r.isAsync && r.checkAsync)
      .map(r => r.checkAsync!(text, ctx).catch((err) => {
        if (opts.onDiagnostic) {
          const packId = findPackForRule(r.id) || 'unknown';
          opts.onDiagnostic({
            ruleId: r.id,
            packId,
            error: err,
            timestamp: new Date().toISOString(),
            phase: 'async',
          });
        }
        return [] as Issue[];
      }))
  );

  let allIssues = [...syncIssues, ...asyncResults.flat().map(stampIdentity)];
  allIssues = deduplicateIssues(allIssues);
  allIssues.sort((a, b) => a.offset - b.offset);

  return allIssues;
}

// ---------------------------------------------------------------------------
// Document-level API — structured sections, cross-paragraph rules
// ---------------------------------------------------------------------------

/** Build full document text from structured sections */
function buildFullText(doc: DocumentInput): string {
  const parts: string[] = [];
  if (doc.headline) parts.push(doc.headline);
  if (doc.excerpt) parts.push(doc.excerpt);
  parts.push(...doc.body);
  return parts.join('\n\n');
}

/** Run check() on a single section and tag results as DocumentIssues */
function checkSection(
  text: string,
  section: DocumentIssue['section'],
  paragraphIndex: number | undefined,
  fullText: string,
  options?: CheckOptions,
): DocumentIssue[] {
  const sectionOpts: CheckOptions = {
    ...options,
    sectionContext: section,
    fullDocumentText: fullText,
  };
  const issues = check(text, sectionOpts);
  return issues.map(issue => ({
    ...issue,
    section,
    paragraphIndex,
  }));
}

/**
 * Document-level entry point (sync).
 * Checks headline, excerpt, and each body paragraph with appropriate section context.
 * Cross-paragraph rules (first-mention, decimal consistency) use the full document text.
 */
export function checkDocument(doc: DocumentInput, options?: CheckOptions): DocumentIssue[] {
  const fullText = buildFullText(doc);
  const allIssues: DocumentIssue[] = [];

  if (doc.headline) {
    allIssues.push(...checkSection(doc.headline, 'headline', undefined, fullText, options));
  }

  if (doc.excerpt) {
    allIssues.push(...checkSection(doc.excerpt, 'excerpt', undefined, fullText, options));
  }

  for (let i = 0; i < doc.body.length; i++) {
    const para = doc.body[i];
    if (para.trim()) {
      allIssues.push(...checkSection(para, 'body', i, fullText, options));
    }
  }

  return allIssues;
}

/**
 * Document-level async entry point.
 * Like checkDocument() but also runs async rules (FX, LLM) if HostServices provided.
 */
export async function checkDocumentAsync(
  doc: DocumentInput,
  options?: CheckOptions,
): Promise<DocumentIssue[]> {
  const fullText = buildFullText(doc);
  const allIssues: DocumentIssue[] = [];

  const sections: { text: string; section: DocumentIssue['section']; index?: number }[] = [];
  if (doc.headline) sections.push({ text: doc.headline, section: 'headline' });
  if (doc.excerpt) sections.push({ text: doc.excerpt, section: 'excerpt' });
  for (let i = 0; i < doc.body.length; i++) {
    if (doc.body[i].trim()) {
      sections.push({ text: doc.body[i], section: 'body', index: i });
    }
  }

  // Run all sections in parallel (each section's async rules run concurrently)
  const sectionResults = await Promise.all(
    sections.map(async ({ text, section, index }) => {
      const sectionOpts: CheckOptions = {
        ...options,
        sectionContext: section,
        fullDocumentText: fullText,
      };
      const issues = await checkAsync(text, sectionOpts);
      return issues.map(issue => ({
        ...issue,
        section,
        paragraphIndex: index,
      } as DocumentIssue));
    })
  );

  for (const results of sectionResults) {
    allIssues.push(...results);
  }

  return allIssues;
}
