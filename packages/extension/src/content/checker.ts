/**
 * Core checker logic — shared between public stet extension and private builds.
 * Discovers editables, runs check(), annotates with LanguageTool-style UI.
 *
 * Usage:
 *   import { initChecker } from './checker.js';
 *   // register your packs first, then:
 *   initChecker();
 */

import { check, checkDocument, toCheckOptions, listPacks } from 'stet';
import type { ResolvedStetConfig, Issue, DocumentIssue } from 'stet';
import { extractText } from './text-extractor.js';
import { AnnotationManager } from './annotation-manager.js';
import { loadDictionary, loadCustomTerms } from './dictionary-loader.js';
import {
  discoverHistoryEditables,
  discoverAnnotatableEditables,
  findAnnotatableEditable,
  findHistoryEditable,
  getEditableTarget,
  notifyEditableChanged,
  replaceEditableRange,
  replaceEditableText,
  supportsInlineAnnotationMarkup,
} from './editable-target.js';
import { resolveIssueApplyRange } from './issue-range.js';
import { getReplacementText } from './replacement-text.js';
import { DEFAULT_HISTORY_POLICY, verifyRestoredContent } from './version-history-core.js';
import {
  loadHistoryRecordByFieldKey,
  loadHistoryRecordForTarget,
  saveSnapshotForTarget,
} from './version-history-store.js';
import {
  getElapsedMs,
  getHistoryTargetLogData,
  getNow,
  logHistoryEvent,
  recordHistoryEventRate,
} from './version-history-debug.js';
import { isHostAllowed } from '../host-access.js';

const managers = new Map<HTMLElement, AnnotationManager>();
const latestIssues = new Map<HTMLElement, Issue[]>();
let config: ResolvedStetConfig | null = null;
const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
let selfMutating = false;
let activeElement: HTMLElement | null = null;
let lastHistoryElement: HTMLElement | null = null;
let runtimeHandlersRegistered = false;
let checkerInitialized = false;
let domObserver: MutationObserver | null = null;
let dictionaryLoadPromise: Promise<string[]> | null = null;
let historyTrackingRegistered = false;
const CHECKER_MARK_SELECTOR = 'stet-mark';
const INPUT_MUTATION_SUPPRESS_MS = 750;
const recentInputAt = new WeakMap<HTMLElement, number>();

interface PopupIssueRecord {
  key: string;
  rule: string;
  severity: Issue['severity'];
  originalText: string;
  suggestion: string | null | undefined;
  description: string;
  canFix: boolean;
}

interface PopupIssueState {
  enabled: boolean;
  totalIssues: number;
  editorCount: number;
  activeFieldKey: string | null;
  activeLabel: string | null;
  issues: PopupIssueRecord[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FALLBACK_CONFIG: ResolvedStetConfig = {
  packs: ['common'], language: 'en-GB', role: 'journalist',
  packConfig: { freThreshold: 30, paragraphCharLimit: 320 },
  rules: { enable: [], disable: [] }, dictionaries: [], prompts: {},
  workflows: {}, feedback: { endpoint: null, batchSize: 20, includeContext: false },
  enabled: true, siteAllowlist: [], debounceMs: 400,
};

async function loadConfig(): Promise<ResolvedStetConfig> {
  try {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
        if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
        resolve(resp?.config || FALLBACK_CONFIG);
      });
    });
  } catch { return FALLBACK_CONFIG; }
}

// ---------------------------------------------------------------------------
// Check + annotate
// ---------------------------------------------------------------------------

/**
 * Extract structured paragraphs from a contenteditable element.
 * Splits on block elements (p, div, br+br) and newlines.
 * First paragraph treated as headline if short (<100 chars).
 */
function extractParagraphs(element: HTMLElement): { headline?: string; body: string[] } {
  const text = extractText(element);
  // Split on double newlines (common in contenteditable output)
  const parts = text.split(/\n\n+/).map(s => s.trim()).filter(Boolean);

  if (parts.length === 0) return { body: [] };

  // Heuristic: first part is headline if it's short and has no period
  const first = parts[0];
  if (parts.length > 1 && first.length < 120 && !first.includes('.')) {
    return { headline: first, body: parts.slice(1) };
  }

  return { body: parts };
}

function getIssues(element: HTMLElement): Issue[] {
  if (!config || !config.enabled) return [];
  const text = extractText(element);
  if (!text.trim()) return [];

  const { headline, body } = extractParagraphs(element);
  const opts = toCheckOptions(config);

  // Use checkDocument for structured checking — per-paragraph limits
  const issues = checkDocument(
    { headline, body },
    { ...opts, onDiagnostic: (d) => console.warn('[stet] Rule error:', d.ruleId, d.error) },
  );

  // Convert DocumentIssue offsets to flat innerText offsets for annotation.
  // Use indexOf on the original innerText to find each section's true start
  // position, avoiding drift from trimmed whitespace or variable separators.
  const fullText = text; // innerText from extractText() above
  const flatIssues: Issue[] = [];

  // Build a map of section → start position in fullText
  const sectionStarts = new Map<string, number>();
  let searchFrom = 0;

  if (headline) {
    const hlStart = fullText.indexOf(headline, searchFrom);
    if (hlStart >= 0) {
      sectionStarts.set('headline', hlStart);
      searchFrom = hlStart + headline.length;
    }
  }

  for (let i = 0; i < body.length; i++) {
    const paraStart = fullText.indexOf(body[i], searchFrom);
    if (paraStart >= 0) {
      sectionStarts.set(`body:${i}`, paraStart);
      searchFrom = paraStart + body[i].length;
    }
  }

  for (const issue of issues) {
    const di = issue as DocumentIssue;
    let globalOffset: number;

    if (di.section === 'headline') {
      globalOffset = (sectionStarts.get('headline') ?? 0) + issue.offset;
    } else if (di.section === 'body' && di.paragraphIndex !== undefined) {
      globalOffset = (sectionStarts.get(`body:${di.paragraphIndex}`) ?? 0) + issue.offset;
    } else {
      globalOffset = issue.offset;
    }

    flatIssues.push({ ...issue, offset: globalOffset });
  }

  return flatIssues;
}

function runCheckAndAnnotate(element: HTMLElement) {
  if (selfMutating) return;
  if (!element.isContentEditable) return;

  const startedAt = getNow();
  const text = extractText(element);
  const beforeMarks = element.querySelectorAll(CHECKER_MARK_SELECTOR).length;

  logHistoryEvent('checker:pre-check', {
    ...getCheckerElementLogData(element),
    textLength: text.length,
    beforeMarks,
  });

  console.log(`[stet] Checking <${element.tagName.toLowerCase()}> (${text.length} chars)`);

  const issues = getIssues(element);
  latestIssues.set(element, issues);

  logHistoryEvent('checker:post-check', {
    ...getCheckerElementLogData(element),
    issueCount: issues.length,
    elapsedMs: getElapsedMs(startedAt),
  });

  if (issues.length > 0) {
    console.log(`[stet] ${issues.length} issue(s):`);
    for (const iss of issues.slice(0, 5)) {
      console.log(`  [${iss.rule}] "${iss.originalText}" → ${iss.suggestion ?? '(no fix)'}`);
    }
    if (issues.length > 5) console.log(`  ... and ${issues.length - 5} more`);
  } else {
    console.log('[stet] No issues found');
  }

  const mgr = getOrCreateManager(element);
  const canInlineAnnotate = supportsInlineAnnotationMarkup(element);

  logHistoryEvent('checker:pre-annotate', {
    ...getCheckerElementLogData(element),
    issueCount: issues.length,
    beforeMarks,
    canInlineAnnotate,
  });

  selfMutating = true;
  try {
    if (canInlineAnnotate) {
      mgr.annotate(issues);
    } else {
      mgr.clear();
      logHistoryEvent('checker:inline-annotations-skip', {
        ...getCheckerElementLogData(element),
        issueCount: issues.length,
        reason: 'complex-contenteditable-dom',
      });
    }
  } finally {
    requestAnimationFrame(() => { selfMutating = false; });
  }

  logHistoryEvent('checker:run', {
    ...getCheckerElementLogData(element),
    textLength: text.length,
    issueCount: issues.length,
    beforeMarks,
    afterMarks: element.querySelectorAll(CHECKER_MARK_SELECTOR).length,
    elapsedMs: getElapsedMs(startedAt),
  });
  syncPageState();
}

function scheduleCheck(element: HTMLElement) {
  if (selfMutating) return;
  const existing = timers.get(element);
  if (existing) clearTimeout(existing);
  const delay = config?.debounceMs ?? 800;
  recordHistoryEventRate('checker:schedule', {
    ...getCheckerElementLogData(element),
    delay,
  });
  timers.set(element, setTimeout(() => runCheckAndAnnotate(element), delay));
}

function pruneDisconnectedElements() {
  for (const [element] of managers) {
    if (element.isConnected) continue;
    managers.delete(element);
    latestIssues.delete(element);
    const timer = timers.get(element);
    if (timer) clearTimeout(timer);
    timers.delete(element);
  }

  if (activeElement && !activeElement.isConnected) {
    activeElement = null;
  }

  if (lastHistoryElement && !lastHistoryElement.isConnected) {
    lastHistoryElement = null;
  }
}

function getPageIssueCount(): number {
  pruneDisconnectedElements();

  let total = 0;
  for (const [element, issues] of latestIssues) {
    if (!element.isConnected) continue;
    total += issues.length;
  }
  return total;
}

function syncPageState() {
  try {
    chrome.runtime.sendMessage({
      type: 'SYNC_PAGE_ISSUES',
      state: getPopupIssuesState(),
    });
  } catch {}
}

function getEditorCount(): number {
  pruneDisconnectedElements();

  let total = 0;
  for (const [element] of managers) {
    if (!element.isConnected) continue;
    total += 1;
  }
  return total;
}

function getIssueSelectionKey(issue: Issue): string {
  if (issue.fingerprint) return `${issue.fingerprint}:${issue.offset}:${issue.length}`;
  return `${issue.rule}:${issue.offset}:${issue.length}:${issue.originalText}`;
}

function getPopupElementLabel(element: HTMLElement): string {
  return getEditableTarget(element)?.label
    ?? element.getAttribute('aria-label')?.trim()
    ?? (element.id ? `#${element.id}` : element.tagName.toLowerCase());
}

function getCheckerElementLogData(element: HTMLElement): Record<string, unknown> {
  const target = getEditableTarget(element);
  if (target) {
    return getHistoryTargetLogData(target);
  }

  return {
    descriptor: element.id ? `${element.tagName.toLowerCase()}#${element.id}` : element.tagName.toLowerCase(),
    label: getPopupElementLabel(element),
    kind: element.isContentEditable ? 'contenteditable' : element.tagName.toLowerCase(),
  };
}

function getEditableFieldKey(element: HTMLElement | null): string | null {
  return element ? (getEditableTarget(element)?.fieldKey ?? null) : null;
}

function rememberHistoryElement(start: EventTarget | null): boolean {
  const editable = findHistoryEditable(start);
  if (!editable?.isConnected) return false;

  const previousElement = lastHistoryElement;
  const previousFieldKey = getEditableFieldKey(previousElement);

  lastHistoryElement = editable;

  return previousElement !== editable || previousFieldKey !== getEditableFieldKey(editable);
}

function getTrackedHistoryElement(): HTMLElement | null {
  const activeHistoryElement = findHistoryEditable(document.activeElement);
  if (activeHistoryElement?.isConnected) {
    lastHistoryElement = activeHistoryElement;
    return activeHistoryElement;
  }

  if (lastHistoryElement?.isConnected) {
    return lastHistoryElement;
  }

  return null;
}

function serializeIssue(issue: Issue): PopupIssueRecord {
  return {
    key: getIssueSelectionKey(issue),
    rule: issue.rule,
    severity: issue.severity,
    originalText: issue.originalText,
    suggestion: issue.suggestion,
    description: issue.description,
    canFix: issue.canFix && typeof issue.suggestion === 'string',
  };
}

function getPreferredPopupElement(): HTMLElement | null {
  pruneDisconnectedElements();

  const activeHistoryElement = getTrackedHistoryElement();
  if (activeHistoryElement) return activeHistoryElement;

  if (activeElement?.isConnected) return activeElement;

  for (const [element, issues] of latestIssues) {
    if (element.isConnected && issues.length > 0) return element;
  }

  for (const [element] of managers) {
    if (element.isConnected) return element;
  }

  return null;
}

function getPopupIssuesState(): PopupIssueState {
  const element = getPreferredPopupElement();
  const issues = element ? (latestIssues.get(element) ?? []) : [];
  const target = element ? getEditableTarget(element) : null;

  return {
    enabled: config?.enabled ?? false,
    totalIssues: getPageIssueCount(),
    editorCount: getEditorCount(),
    activeFieldKey: target?.fieldKey ?? null,
    activeLabel: element ? getPopupElementLabel(element) : null,
    issues: issues.map(serializeIssue),
  };
}

async function applySelectedFixes(element: HTMLElement, selectedIssueKeys: string[]): Promise<number> {
  const startedAt = getNow();
  const issues = latestIssues.get(element) ?? [];
  if (issues.length === 0) return 0;

  let text = extractText(element);
  let applied = 0;
  let nextLockedStart = Number.POSITIVE_INFINITY;

  const selected = issues
    .filter((issue) => selectedIssueKeys.includes(getIssueSelectionKey(issue)))
    .filter((issue) => issue.canFix && typeof issue.suggestion === 'string')
    .sort((left, right) => right.offset - left.offset);

  let usedFullReplacement = false;

  for (const issue of selected) {
    const range = resolveIssueApplyRange(text, issue);
    if (!range) continue;
    if (range.end > nextLockedStart) continue;
    const replacement = getReplacementText(text, range.start, issue.originalText, issue.suggestion!);

    if (element.isContentEditable) {
      const replaced = replaceEditableRange(element, range.start, range.end, replacement);
      if (!replaced) {
        usedFullReplacement = true;
      }
    } else {
      usedFullReplacement = true;
    }

    text = `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
    nextLockedStart = range.start;
    applied += 1;
  }

  if (applied > 0) {
    if (usedFullReplacement) {
      replaceEditableText(element, text);
    } else {
      notifyEditableChanged(element);
    }
    runCheckAndAnnotate(element);
  }

  logHistoryEvent('checker:apply', {
    ...getCheckerElementLogData(element),
    selectedCount: selected.length,
    appliedCount: applied,
    usedFullReplacement,
    resultingIssueCount: (latestIssues.get(element) ?? []).length,
    elapsedMs: getElapsedMs(startedAt),
  }, { level: applied > 0 ? 'debug' : 'warn' });

  return applied;
}

async function getEditorHistoryState(fieldKey: string): Promise<{
  ok: boolean;
  liveEditorAvailable: boolean;
  currentText: string;
  label: string | null;
  record: import('./version-history-core.js').EditableHistoryRecord | null;
}> {
  const element = findElementByFieldKey(fieldKey);
  if (!element) {
    const record = await loadHistoryRecordByFieldKey(fieldKey);
    return {
      ok: false,
      liveEditorAvailable: false,
      currentText: '',
      label: record?.label ?? null,
      record,
    };
  }

  const target = getEditableTarget(element);
  if (!target) {
    return {
      ok: false,
      liveEditorAvailable: false,
      currentText: extractText(element),
      label: getPopupElementLabel(element),
      record: await loadHistoryRecordByFieldKey(fieldKey),
    };
  }

  return {
    ok: true,
    liveEditorAvailable: true,
    currentText: extractText(element),
    label: getPopupElementLabel(element),
    record: await loadHistoryRecordForTarget(target),
  };
}

async function captureEditorSnapshot(fieldKey: string): Promise<{
  ok: boolean;
  currentText: string;
}> {
  const element = findElementByFieldKey(fieldKey);
  if (!element) {
    return { ok: false, currentText: '' };
  }

  const target = getEditableTarget(element);
  if (!target) {
    return { ok: false, currentText: '' };
  }

  const currentText = extractText(element);
  await saveSnapshotForTarget(target, currentText, 'manual', DEFAULT_HISTORY_POLICY, true);
  return { ok: true, currentText };
}

async function restoreEditorSnapshot(
  fieldKey: string,
  snapshotId: string,
): Promise<{
  ok: boolean;
  currentText: string;
  state: PopupIssueState;
  error?: string;
}> {
  const element = findElementByFieldKey(fieldKey);
  if (!element) {
    return { ok: false, currentText: '', state: getPopupIssuesState() };
  }

  const target = getEditableTarget(element);
  if (!target) {
    return { ok: false, currentText: '', state: getPopupIssuesState() };
  }

  const record = await loadHistoryRecordForTarget(target);
  const snapshot = record?.snapshots.find((entry) => entry.id === snapshotId);
  if (!snapshot) {
    return { ok: false, currentText: extractText(element), state: getPopupIssuesState() };
  }

  const startedAt = getNow();
  replaceEditableText(element, snapshot.content);
  const currentText = extractText(element);
  const verification = verifyRestoredContent(snapshot.content, currentText);
  logHistoryEvent('history:restore', {
    ...getHistoryTargetLogData(target),
    snapshotId,
    ...verification,
    elapsedMs: getElapsedMs(startedAt),
    source: 'popup',
  }, { level: verification.ok ? 'debug' : 'warn' });

  if (!verification.ok) {
    return {
      ok: false,
      currentText,
      state: getPopupIssuesState(),
      error: 'The editor did not accept the restored text exactly.',
    };
  }

  await saveSnapshotForTarget(target, snapshot.content, 'restore', DEFAULT_HISTORY_POLICY, true);
  runCheckAndAnnotate(element);

  return {
    ok: true,
    currentText,
    state: getPopupIssuesState(),
  };
}

function findElementByFieldKey(fieldKey: string): HTMLElement | null {
  pruneDisconnectedElements();

  const activeHistoryElement = getTrackedHistoryElement();
  if (activeHistoryElement && getEditableFieldKey(activeHistoryElement) === fieldKey) {
    return activeHistoryElement;
  }

  for (const [element] of managers) {
    if (!element.isConnected) continue;
    if (getEditableTarget(element)?.fieldKey === fieldKey) return element;
  }

  for (const element of discoverHistoryEditables()) {
    if (getEditableFieldKey(element) !== fieldKey) continue;
    lastHistoryElement = element;
    return element;
  }

  return null;
}

function registerHistoryTracking() {
  if (historyTrackingRegistered) return;
  historyTrackingRegistered = true;

  document.addEventListener('focusin', (event) => {
    if (rememberHistoryElement(event.target)) {
      syncPageState();
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (rememberHistoryElement(event.target)) {
      syncPageState();
    }
  }, true);
}

function registerRuntimeHandlers() {
  if (runtimeHandlersRegistered) return;
  runtimeHandlersRegistered = true;

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'GET_PAGE_ISSUES') {
        sendResponse(getPopupIssuesState());
        return false;
      }

      if (message?.type === 'APPLY_EDITOR_ISSUES') {
        const fieldKey = typeof message.fieldKey === 'string' ? message.fieldKey : '';
        const issueKeys = Array.isArray(message.issueKeys) ? message.issueKeys : [];
        const element = findElementByFieldKey(fieldKey);

        if (!element) {
          sendResponse({ ok: false, applied: 0, state: getPopupIssuesState() });
          return false;
        }

        void applySelectedFixes(element, issueKeys).then((applied) => {
          sendResponse({ ok: true, applied, state: getPopupIssuesState() });
        });
        return true;
      }

      if (message?.type === 'GET_EDITOR_HISTORY_STATE') {
        const fieldKey = typeof message.fieldKey === 'string' ? message.fieldKey : '';
        void getEditorHistoryState(fieldKey).then(sendResponse);
        return true;
      }

      if (message?.type === 'CAPTURE_EDITOR_SNAPSHOT') {
        const fieldKey = typeof message.fieldKey === 'string' ? message.fieldKey : '';
        void captureEditorSnapshot(fieldKey).then(sendResponse);
        return true;
      }

      if (message?.type === 'RESTORE_EDITOR_SNAPSHOT') {
        const fieldKey = typeof message.fieldKey === 'string' ? message.fieldKey : '';
        const snapshotId = typeof message.snapshotId === 'string' ? message.snapshotId : '';
        void restoreEditorSnapshot(fieldKey, snapshotId).then(sendResponse);
        return true;
      }

      return false;
    });
  } catch {}
}

function refreshAllChecks() {
  pruneDisconnectedElements();
  discoverAnnotatableEditables().forEach((element) => {
    attachListener(element);
    runCheckAndAnnotate(element);
  });
}

function findEditableForNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node instanceof HTMLElement) {
    return findAnnotatableEditable(node);
  }
  if (node.parentElement) {
    return findAnnotatableEditable(node.parentElement);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Element discovery
// ---------------------------------------------------------------------------

function attachListener(el: HTMLElement) {
  if (managers.has(el)) return;
  managers.set(el, createAnnotationManager(el));
  logHistoryEvent('checker:attach', getCheckerElementLogData(el));

  el.addEventListener('input', () => {
    if (selfMutating) return;
    recentInputAt.set(el, getNow());
    recordHistoryEventRate('checker:input', getCheckerElementLogData(el));
    scheduleCheck(el);
  });

  el.addEventListener('focus', () => {
    activeElement = el;
    logHistoryEvent('checker:focus', getCheckerElementLogData(el));
    syncPageState();
  });

  setTimeout(() => runCheckAndAnnotate(el), 300);
}

function createAnnotationManager(element: HTMLElement): AnnotationManager {
  return new AnnotationManager(element, {
    onApplyIssue: (issue) => {
      void applySelectedFixes(element, [getIssueSelectionKey(issue)]);
    },
  });
}

function getOrCreateManager(element: HTMLElement): AnnotationManager {
  let mgr = managers.get(element);
  if (!mgr) {
    mgr = createAnnotationManager(element);
    managers.set(element, mgr);
  }
  return mgr;
}

function discoverEditables() {
  pruneDisconnectedElements();
  const editables = discoverAnnotatableEditables();
  editables.forEach(attachListener);
  logHistoryEvent('checker:discover', {
    hostname: window.location.hostname,
    count: editables.length,
  });
  syncPageState();
}

function observeDOM() {
  if (domObserver) return;

  domObserver = new MutationObserver((mutations) => {
    if (selfMutating) return;

    pruneDisconnectedElements();
    const changedEditables = new Set<HTMLElement>();

    for (const mutation of mutations) {
      const mutationEditable = findEditableForNode(mutation.target);
      if (mutationEditable) changedEditables.add(mutationEditable);

      for (const node of mutation.addedNodes) {
        const changedEditable = findEditableForNode(node);
        if (changedEditable) changedEditables.add(changedEditable);

        if (node instanceof HTMLElement) {
          const editable = findAnnotatableEditable(node);
          if (editable) attachListener(editable);
          discoverAnnotatableEditables(node).forEach((discovered) => {
            attachListener(discovered);
            changedEditables.add(discovered);
          });
        }
      }
    }

    changedEditables.forEach((editable) => {
      if (!editable.isConnected) return;

      const lastInputAt = recentInputAt.get(editable);
      if (typeof lastInputAt === 'number' && getNow() - lastInputAt < INPUT_MUTATION_SUPPRESS_MS) {
        recordHistoryEventRate('checker:mutation-skip-after-input', getCheckerElementLogData(editable));
        return;
      }

      scheduleCheck(editable);
    });
    recordHistoryEventRate('checker:mutation-batch', {
      mutationCount: mutations.length,
      changedEditableCount: changedEditables.size,
    });
    syncPageState();
  });
  domObserver.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the spell-check dictionary from CDN and cache locally.
 * Runs in the background — doesn't block checker startup.
 * Returns the word list (or empty array on failure).
 */
async function loadSpellCheckDictionary(): Promise<string[]> {
  try {
    const [words, customTerms] = await Promise.all([
      loadDictionary(),
      loadCustomTerms(),
    ]);
    return [...words, ...customTerms];
  } catch (err) {
    console.warn('[stet] Dictionary load failed:', err);
    return [];
  }
}

function loadSpellCheckDictionaryOnce(): Promise<string[]> {
  if (!dictionaryLoadPromise) {
    dictionaryLoadPromise = loadSpellCheckDictionary();
  }
  return dictionaryLoadPromise;
}

/** Callback type for dictionary loading hook */
export type OnDictionaryLoaded = (words: string[]) => void;

/**
 * Initialize the checker. Call this AFTER registering all packs.
 *
 * @param onDictionaryLoaded — optional callback invoked when the spell-check
 *   dictionary is ready. Packs use this to feed words into their spell-check
 *   rules (e.g., `loadWordList(words)` in bt-pack).
 */
export async function initChecker(onDictionaryLoaded?: OnDictionaryLoaded) {
  if (checkerInitialized) {
    console.warn('[stet] Checker already initialized; skipping duplicate init');
    return;
  }
  checkerInitialized = true;

  config = await loadConfig();

  // Override config packs with whatever is actually registered
  const registered = listPacks().map(p => p.id);
  config = { ...config, packs: registered };

  // Sync actual packs back to storage so popup reflects reality
  try {
    chrome.runtime.sendMessage({
      type: 'SET_RESOLVED_CONFIG',
      config,
    });
  } catch {}

  if (!config.enabled) { console.log('[stet] Disabled'); return; }

  if (!isHostAllowed(window.location.hostname, config.siteAllowlist)) {
    console.log('[stet] Skipping checker on host', window.location.hostname);
    return;
  }

  console.log('[stet] Active — packs:', registered.map(id => {
    const p = listPacks().find(p => p.id === id);
    return `${id} (${p?.rules.length ?? 0} rules)`;
  }).join(', '));

  discoverEditables();
  observeDOM();
  registerRuntimeHandlers();
  registerHistoryTracking();
  activeElement = findAnnotatableEditable(document.activeElement);
  lastHistoryElement = findHistoryEditable(document.activeElement);
  syncPageState();

  // Load dictionary in the background — doesn't block initial check
  loadSpellCheckDictionaryOnce().then((words) => {
    if (words.length > 0 && onDictionaryLoaded) {
      onDictionaryLoaded(words);
      console.log(`[stet] Dictionary ready (${words.length} words)`);
      refreshAllChecks();
    }
  });
}
