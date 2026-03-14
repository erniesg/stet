/** Severity level for an issue */
export type Severity = 'error' | 'warning' | 'info';

/** Section context for where text appears */
export type SectionContext = 'body' | 'headline' | 'excerpt';

/** Supported languages */
export type Language = 'en-GB' | 'en-US';

/** A single issue found by a rule */
export interface Issue {
  /**
   * Unique occurrence ID for this issue in a single run.
   * Always populated by the engine on output — rules should not set this.
   */
  issueId?: string;
  /**
   * Stable identity across reruns/consumers — used for ignore lists, analytics, feedback.
   * Derived from rule + originalText + suggestion. Always populated by the engine on output.
   */
  fingerprint?: string;
  /** Rule ID, e.g. 'MY-RULE-01', 'COMMON-PASSIVE-01' */
  rule: string;
  /** Human-readable rule name */
  name: string;
  /** Issue category */
  category: string;
  /** Severity level */
  severity: Severity;
  /** The text that triggered the rule */
  originalText: string;
  /** Suggested replacement (null if no auto-fix) */
  suggestion: string | null;
  /** Short description of the issue */
  description: string;
  /** Character offset from start of input text */
  offset: number;
  /** Length of the matched text */
  length: number;
  /** The paragraph/context snippet */
  textSnippet?: string;
  /** Whether this issue can be auto-fixed */
  canFix: boolean;
  /** Additional metadata (rule-specific) */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Diagnostics — rule-error reporting hook
// ---------------------------------------------------------------------------

/** A diagnostic event emitted when a rule throws during execution */
export interface RuleDiagnostic {
  /** Which rule threw */
  ruleId: string;
  /** The pack the rule belongs to */
  packId: string;
  /** The error that was caught */
  error: unknown;
  /** When the error occurred */
  timestamp: string;
  /** Which API surface was running (check, checkAsync, checkDocument, etc.) */
  phase: 'sync' | 'async';
}

/** Hook that consumers can provide to receive rule-error diagnostics */
export type DiagnosticsHook = (diagnostic: RuleDiagnostic) => void;

/** Context passed to rule check functions */
export interface CheckContext {
  /** Which section the text comes from */
  sectionContext: SectionContext;
  /** Full document text (for cross-paragraph checks) */
  fullDocumentText: string;
  /** Currently active pack IDs */
  activePacks: string[];
  /** Currently active role */
  activeRole: string;
  /** Pack-specific config (FRE threshold, language, etc.) */
  packConfig: PackConfig;
  /** Host services for async enrichment (provided by consumer) */
  host?: HostServices;
  /** Document metadata (provided by checkDocument consumers) */
  documentMetadata?: DocumentMetadata;
}

/** Configuration specific to a rule pack */
export interface PackConfig {
  /** Flesch Reading Ease threshold */
  freThreshold?: number;
  /** Max headline characters */
  headlineCharLimit?: number;
  /** Language variant */
  language?: Language;
  /** Max paragraph character count */
  paragraphCharLimit?: number;
  /** Max body word count */
  bodyWordLimit?: number;
}

/** A function that checks text and returns issues */
export type RuleFunction = (text: string, ctx: CheckContext) => Issue[];

/** A function that checks text asynchronously */
export type AsyncRuleFunction = (text: string, ctx: CheckContext) => Promise<Issue[]>;

/** Definition of a single rule */
export interface RuleDefinition {
  /** Unique rule ID, e.g. 'MY-RULE-01' */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category for grouping/filtering */
  category: string;
  /** Severity level */
  severity: Severity;
  /** The check function */
  check: RuleFunction;
  /** Optional async check (for API-dependent rules) */
  checkAsync?: AsyncRuleFunction;
  /** Whether this rule requires async execution */
  isAsync?: boolean;
  /** Example inputs for documentation/testing */
  examples?: RuleExample[];
  /** Description of what this rule checks */
  description?: string;
}

/** Example for a rule (used in docs and tests) */
export interface RuleExample {
  /** Input text */
  input: string;
  /** The text that should be flagged */
  flagged: string;
  /** The suggested replacement */
  suggestion: string;
}

/** A dictionary entry for word lookups */
export interface DictionaryEntry {
  /** Correct form */
  correct: string;
  /** Wrong forms to match */
  wrong: string[];
  /** Style guide line number (for reference) */
  line?: number;
  /** Whether matching is case-sensitive */
  caseSensitive?: boolean;
  /** Exception phrases where the wrong form is OK */
  exceptions?: string[];
}

/** A rule pack (tenant-specific collection of rules) */
export interface RulePack {
  /** Pack ID: 'common', 'bt', 'tia' */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** The rules in this pack */
  rules: RuleDefinition[];
  /** Tenant-specific dictionaries */
  dictionaries?: DictionaryEntry[];
  /** Pack-specific configuration */
  config: PackConfig;
}

/** A role preset that determines default category toggles */
export interface RolePreset {
  /** Role ID */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Categories enabled by default */
  enabledCategories: string[];
  /** Categories disabled by default */
  disabledCategories: string[];
}

/** Options for the check() function */
export interface CheckOptions {
  /** Which packs to activate (default: all registered) */
  packs?: string[];
  /** Which role to use (affects default category filtering) */
  role?: string;
  /** Section context */
  sectionContext?: SectionContext;
  /** Full document text for cross-paragraph rules */
  fullDocumentText?: string;
  /** Override specific rule enablement */
  enabledRules?: string[];
  /** Disable specific rules */
  disabledRules?: string[];
  /** Override pack config */
  configOverrides?: Partial<PackConfig>;
  /** Host services for async enrichment (FX, LLM) */
  host?: HostServices;
  /** Hook to receive diagnostics when rules throw errors */
  onDiagnostic?: DiagnosticsHook;
}

// ---------------------------------------------------------------------------
// Document model — structured input for cross-section rules
// ---------------------------------------------------------------------------

/** Structured document input for checkDocument() */
export interface DocumentInput {
  /** Headline text */
  headline?: string;
  /** Excerpt / standfirst text */
  excerpt?: string;
  /** Body paragraphs (each string is one paragraph) */
  body: string[];
  /** Document metadata for host-specific context */
  metadata?: DocumentMetadata;
}

/** Metadata that consumers can attach to a document */
export interface DocumentMetadata {
  /** Whether this is a newsletter story (affects link-length rules) */
  isNewsletter?: boolean;
  /** Tenant ID for tenant-aware rules */
  tenant?: string;
  /** Arbitrary extra metadata */
  [key: string]: unknown;
}

/** An issue located within a specific document section */
export interface DocumentIssue extends Issue {
  /** Which section this issue was found in */
  section: SectionContext;
  /** Index into body[] for body issues (undefined for headline/excerpt) */
  paragraphIndex?: number;
}

// ---------------------------------------------------------------------------
// Host services — async enrichment contract
// ---------------------------------------------------------------------------

/** FX rate result from host */
export interface FxRateResult {
  rate: number;
  timestamp: string;
  source: string;
}

/**
 * Host services that consumers optionally provide for async rule enrichment.
 * If not provided, async rules (FX conversion, LLM spelling) simply don't run.
 * This keeps CI and agent consumers deterministic.
 */
export interface HostServices {
  /** Fetch a foreign exchange rate. Used by BT-CUR-02 (currency conversion). */
  fetchFxRate?: (from: string, to: string) => Promise<FxRateResult>;
  /** Run an LLM check on text. Used by BT-SPELL-LLM (optional spelling). */
  llmCheck?: (text: string, prompt: string) => Promise<string>;
  /** Invoke a named workflow (e.g. post-check webhook). */
  invokeWorkflow?: (name: string, payload: unknown) => Promise<unknown>;
  /** Send collected feedback to a sink (e.g. analytics endpoint). */
  sendFeedback?: (items: SuggestionFeedback[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Suggestion feedback — for collecting user responses to issues
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Configuration — declarative config + resolved runtime config
// ---------------------------------------------------------------------------

/**
 * Declarative config as written in stet.config.yaml.
 * This is the authoring format — newsrooms write this.
 */
export interface StetConfig {
  /** Pack IDs or npm package names to activate */
  packs: string[];
  /** Language variant */
  language?: Language;
  /** Default role */
  roles?: { default?: string };
  /** Pack config overrides */
  config?: Partial<PackConfig>;
  /** Paths to dictionary files */
  dictionaries?: string[];
  /** Named prompt templates (key → file path or inline) */
  prompts?: Record<string, string>;
  /** Named workflow endpoints */
  workflows?: Record<string, string>;
  /** Feedback sink configuration */
  feedback?: {
    endpoint?: string;
    batchSize?: number;
    includeContext?: boolean;
  };
  /** Explicit rule enable/disable lists */
  rules?: {
    enable?: string[];
    disable?: string[];
  };
}

/**
 * Resolved config ready for consumption by any runtime (Node, extension, CI).
 * No file paths, no npm package names — everything is pre-resolved.
 * The extension consumes this as a JSON blob; Node resolves it at startup.
 */
export interface ResolvedStetConfig {
  /** Resolved pack IDs (already registered in the engine) */
  packs: string[];
  /** Language variant */
  language: Language;
  /** Active role ID */
  role: string;
  /** Merged pack config */
  packConfig: PackConfig;
  /** Rule enable/disable overrides */
  rules: {
    enable: string[];
    disable: string[];
  };
  /** Resolved dictionary entries (loaded from files) */
  dictionaries: DictionaryEntry[];
  /** Resolved prompt contents (key → prompt text) */
  prompts: Record<string, string>;
  /** Workflow endpoint names (key → URL) */
  workflows: Record<string, string>;
  /** Feedback sink config */
  feedback: {
    endpoint: string | null;
    batchSize: number;
    includeContext: boolean;
  };
  /** Whether the extension is enabled */
  enabled: boolean;
  /** Site allowlist (empty = all sites) */
  siteAllowlist: string[];
  /** Debounce interval for real-time checking (ms) */
  debounceMs: number;
}

/**
 * Per-user overrides stored in chrome.storage.sync.
 * The extension layers these on top of the resolved newsroom config.
 * Only fields the user explicitly changed are set.
 */
export interface UserOverrides {
  /** Override enabled state */
  enabled?: boolean;
  /** Override active role */
  role?: string;
  /** Additional rules to disable (user-level ignore) */
  disableRules?: string[];
  /** Per-site enable/disable */
  siteAllowlist?: string[];
  /** Debounce override */
  debounceMs?: number;
}

/** Feedback on a specific suggestion, collected by the extension or UI */
export interface SuggestionFeedback {
  /** The issueId from the run that produced the issue */
  issueId: string;
  /** Stable fingerprint for cross-run aggregation */
  fingerprint: string;
  /** Which rule produced this issue */
  ruleId: string;
  /** User's verdict */
  verdict: 'correct' | 'false-positive' | 'false-negative' | 'other';
  /** The text that was flagged */
  originalText: string;
  /** The suggestion that was offered */
  suggestion: string | null;
  /** Surrounding context (optional) */
  context?: string;
  /** What the user did */
  action?: 'accepted' | 'dismissed' | 'ignored' | 'ignored-all';
  /** Optional free-text comment */
  userComment?: string;
  /** ISO timestamp */
  timestamp: string;
}
