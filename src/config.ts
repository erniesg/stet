import type {
  StetConfig, ResolvedStetConfig, UserOverrides,
  PackConfig, DictionaryEntry, Language,
} from './types.js';
import { listPacks } from './engine.js';

// ---------------------------------------------------------------------------
// Default resolved config — what you get with zero configuration
// ---------------------------------------------------------------------------

export const DEFAULT_RESOLVED_CONFIG: ResolvedStetConfig = {
  packs: ['common'],
  language: 'en-GB',
  role: 'journalist',
  packConfig: {
    freThreshold: 30,
    paragraphCharLimit: 320,
  },
  rules: { enable: [], disable: [] },
  dictionaries: [],
  prompts: {},
  workflows: {},
  feedback: { endpoint: null, batchSize: 20, includeContext: false },
  enabled: true,
  siteAllowlist: [],
  debounceMs: 500,
};

// ---------------------------------------------------------------------------
// Resolve declarative config → runtime config
// ---------------------------------------------------------------------------

/**
 * Resolve a declarative StetConfig into a ResolvedStetConfig.
 *
 * This is the Node-side resolver. It:
 * - Validates that referenced packs are registered
 * - Merges pack configs with overrides
 * - Resolves language, role, rules, feedback, workflows, prompts
 *
 * Dictionary file loading and prompt file reading are NOT done here —
 * the caller passes already-loaded dictionaries/prompts if needed.
 */
export function resolveConfig(
  raw: StetConfig,
  opts?: {
    dictionaries?: DictionaryEntry[];
    prompts?: Record<string, string>;
  },
): ResolvedStetConfig {
  const registeredPacks = listPacks();
  const registeredIds = new Set(registeredPacks.map(p => p.id));

  // Validate packs — warn but don't crash on missing packs
  const validPacks = raw.packs.filter(id => {
    // Normalize stet/common → common
    const normalized = id.replace(/^stet\//, '');
    return registeredIds.has(normalized) || registeredIds.has(id);
  });
  const resolvedPackIds = validPacks.map(id => id.replace(/^stet\//, ''));

  // Merge pack configs
  const mergedConfig: PackConfig = {};
  for (const id of resolvedPackIds) {
    const pack = registeredPacks.find(p => p.id === id);
    if (pack) Object.assign(mergedConfig, pack.config);
  }
  if (raw.config) Object.assign(mergedConfig, raw.config);

  // Language
  const language: Language = raw.language || mergedConfig.language || 'en-GB';

  return {
    packs: resolvedPackIds.length > 0 ? resolvedPackIds : ['common'],
    language,
    role: raw.roles?.default || 'subeditor',
    packConfig: { ...mergedConfig, language },
    rules: {
      enable: raw.rules?.enable || [],
      disable: raw.rules?.disable || [],
    },
    dictionaries: opts?.dictionaries || [],
    prompts: opts?.prompts || {},
    workflows: raw.workflows || {},
    feedback: {
      endpoint: raw.feedback?.endpoint || null,
      batchSize: raw.feedback?.batchSize ?? 20,
      includeContext: raw.feedback?.includeContext ?? false,
    },
    enabled: true,
    siteAllowlist: [],
    debounceMs: 500,
  };
}

// ---------------------------------------------------------------------------
// Apply user overrides on top of resolved config
// ---------------------------------------------------------------------------

/**
 * Layer per-user overrides on top of a resolved newsroom config.
 * Used by the extension to combine org config with user preferences.
 */
export function applyUserOverrides(
  base: ResolvedStetConfig,
  overrides: UserOverrides,
): ResolvedStetConfig {
  const result: ResolvedStetConfig = {
    ...base,
    packs: [...base.packs],
    packConfig: { ...base.packConfig },
    rules: {
      enable: [...base.rules.enable],
      disable: [...base.rules.disable],
    },
    dictionaries: [...base.dictionaries],
    prompts: { ...base.prompts },
    workflows: { ...base.workflows },
    feedback: { ...base.feedback },
    siteAllowlist: [...base.siteAllowlist],
  };

  if (overrides.enabled !== undefined) {
    result.enabled = overrides.enabled;
  }
  if (overrides.language) {
    result.language = overrides.language;
    result.packConfig.language = overrides.language;
  }
  if (overrides.role) {
    result.role = overrides.role;
  }
  if (overrides.debounceMs !== undefined) {
    result.debounceMs = overrides.debounceMs;
  }
  if (overrides.siteAllowlist) {
    result.siteAllowlist = overrides.siteAllowlist;
  }
  if (overrides.disableRules && overrides.disableRules.length > 0) {
    result.rules = {
      ...result.rules,
      disable: [...new Set([...result.rules.disable, ...overrides.disableRules])],
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Convert ResolvedStetConfig → CheckOptions
// ---------------------------------------------------------------------------

/**
 * Convert a resolved config into CheckOptions for the engine.
 * This is the bridge between config and the check() API.
 */
export function toCheckOptions(config: ResolvedStetConfig): import('./types.js').CheckOptions {
  return {
    packs: config.packs,
    role: config.role,
    enabledRules: config.rules.enable.length > 0 ? config.rules.enable : undefined,
    disabledRules: config.rules.disable.length > 0 ? config.rules.disable : undefined,
    configOverrides: { ...config.packConfig, language: config.language },
  };
}
