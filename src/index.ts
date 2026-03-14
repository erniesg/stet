// Core API
export {
  check, checkAsync, checkDocument, checkDocumentAsync,
  registerPack, getPack, listPacks, getRole, listRoles,
  getRulesForPack, runRule,
} from './engine.js';

// Types
export type {
  Issue, CheckOptions, CheckContext, RulePack, RuleDefinition,
  RuleFunction, AsyncRuleFunction, RuleExample, DictionaryEntry,
  RolePreset, PackConfig, Severity, SectionContext, Language,
  DocumentInput, DocumentIssue, DocumentMetadata,
  HostServices, FxRateResult,
  RuleDiagnostic, DiagnosticsHook, SuggestionFeedback,
  StetConfig, ResolvedStetConfig, UserOverrides,
} from './types.js';

// Config (browser-safe — no fs/path/yaml imports)
export {
  resolveConfig, applyUserOverrides, toCheckOptions,
  DEFAULT_RESOLVED_CONFIG,
} from './config.js';

// Note: loadConfig() is Node-only — import from 'stet/node' or 'stet/config-loader'

// Role presets
export { JOURNALIST, SUB_EDITOR, EDITOR, ONLINE, builtInRoles } from './roles.js';

// NLP utilities
export { stem } from './nlp/stemmer.js';
export { countSyllables } from './nlp/syllable-counter.js';

// Built-in packs (auto-register on import)
export { commonPack } from './packs/common/index.js';
export { loadCommonDictionary } from './packs/common/index.js';
