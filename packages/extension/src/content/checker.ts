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
  discoverAnnotatableEditables,
  findAnnotatableEditable,
  getEditableTarget,
  notifyEditableChanged,
  replaceEditableRange,
  replaceEditableText,
} from './editable-target.js';
import { resolveIssueApplyRange } from './issue-range.js';
import { DEFAULT_HISTORY_POLICY } from './version-history-core.js';
import { loadHistoryRecord, saveSnapshotForTarget } from './version-history-store.js';

const managers = new Map<HTMLElement, AnnotationManager>();
const latestIssues = new Map<HTMLElement, Issue[]>();
let config: ResolvedStetConfig | null = null;
const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
let selfMutating = false;
let activeElement: HTMLElement | null = null;
let runtimeHandlersRegistered = false;

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

  const text = extractText(element);
  console.log(`[stet] Checking <${element.tagName.toLowerCase()}> (${text.length} chars)`);

  const issues = getIssues(element);
  latestIssues.set(element, issues);

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

  selfMutating = true;
  try {
    mgr.annotate(issues);
  } finally {
    requestAnimationFrame(() => { selfMutating = false; });
  }

  syncPageState();
}

function scheduleCheck(element: HTMLElement) {
  if (selfMutating) return;
  const existing = timers.get(element);
  if (existing) clearTimeout(existing);
  const delay = config?.debounceMs ?? 800;
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

    if (element.isContentEditable) {
      const replaced = replaceEditableRange(element, range.start, range.end, issue.suggestion!);
      if (!replaced) {
        usedFullReplacement = true;
      }
    } else {
      usedFullReplacement = true;
    }

    text = `${text.slice(0, range.start)}${issue.suggestion!}${text.slice(range.end)}`;
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

  return applied;
}

async function getEditorHistoryState(fieldKey: string): Promise<{
  ok: boolean;
  currentText: string;
  label: string | null;
}> {
  const element = findElementByFieldKey(fieldKey);
  if (!element) {
    return { ok: false, currentText: '', label: null };
  }

  return {
    ok: true,
    currentText: extractText(element),
    label: getPopupElementLabel(element),
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
}> {
  const element = findElementByFieldKey(fieldKey);
  if (!element) {
    return { ok: false, currentText: '', state: getPopupIssuesState() };
  }

  const target = getEditableTarget(element);
  if (!target) {
    return { ok: false, currentText: '', state: getPopupIssuesState() };
  }

  const record = await loadHistoryRecord(target.storageKey);
  const snapshot = record?.snapshots.find((entry) => entry.id === snapshotId);
  if (!snapshot) {
    return { ok: false, currentText: extractText(element), state: getPopupIssuesState() };
  }

  replaceEditableText(element, snapshot.content);
  await saveSnapshotForTarget(target, snapshot.content, 'restore', DEFAULT_HISTORY_POLICY, true);
  runCheckAndAnnotate(element);

  return {
    ok: true,
    currentText: snapshot.content,
    state: getPopupIssuesState(),
  };
}

function findElementByFieldKey(fieldKey: string): HTMLElement | null {
  pruneDisconnectedElements();

  for (const [element] of managers) {
    if (!element.isConnected) continue;
    if (getEditableTarget(element)?.fieldKey === fieldKey) return element;
  }

  return null;
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

  el.addEventListener('input', () => {
    if (selfMutating) return;
    scheduleCheck(el);
  });

  el.addEventListener('focus', () => {
    activeElement = el;
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
  discoverAnnotatableEditables().forEach(attachListener);
  syncPageState();
}

function observeDOM() {
  const observer = new MutationObserver((mutations) => {
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
      if (editable.isConnected) scheduleCheck(editable);
    });
    syncPageState();
  });
  observer.observe(document.body ?? document.documentElement, {
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

  if (config.siteAllowlist.length > 0) {
    const host = window.location.hostname;
    if (!config.siteAllowlist.some(s => host.includes(s))) return;
  }

  console.log('[stet] Active — packs:', registered.map(id => {
    const p = listPacks().find(p => p.id === id);
    return `${id} (${p?.rules.length ?? 0} rules)`;
  }).join(', '));

  discoverEditables();
  observeDOM();
  registerRuntimeHandlers();
  activeElement = findAnnotatableEditable(document.activeElement);
  syncPageState();

  // Load dictionary in the background — doesn't block initial check
  loadSpellCheckDictionary().then((words) => {
    if (words.length > 0 && onDictionaryLoaded) {
      onDictionaryLoaded(words);
      console.log(`[stet] Dictionary ready (${words.length} words)`);
      refreshAllChecks();
    }
  });
}
