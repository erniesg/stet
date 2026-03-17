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
import { AnnotationManager, isCardOpen } from './annotation-manager.js';
import { loadDictionary, loadCustomTerms } from './dictionary-loader.js';
import {
  applyGoogleDocsReplacement,
  rememberGoogleDocsCaret,
} from './google-docs-write.js';
import {
  discoverHistoryEditables,
  findHistoryEditable,
  getAnnotationSupport,
  getEditableTarget,
  isGoogleDocsEditableRoot,
  notifyEditableChanged,
  readEditableText,
  replaceEditableRange,
  replaceEditableText,
} from './editable-target.js';
// import { IssuePanelManager } from './issue-panel.js';
import { resolveIssueApplyRange } from './issue-range.js';
import { getReplacementText } from './replacement-text.js';
import {
  createTextareaMirror,
  isMirroredTextarea,
} from './textarea-mirror.js';
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
  isHistoryDebugEnabled,
  isHistoryRuntimeDisabled,
  logHistoryEvent,
  recordHistoryEventRate,
} from './version-history-debug.js';
import { resolveHistoryRuntimeConfig } from '../history-settings.js';
import { isHostAllowed } from '../host-access.js';

const managers = new Map<HTMLElement, AnnotationManager>();
const latestIssues = new Map<HTMLElement, Issue[]>();
const ignoredIssueKeys = new WeakMap<HTMLElement, Set<string>>();
const ignoredIssueFingerprints = new WeakMap<HTMLElement, Set<string>>();
const trackedEditables = new Set<HTMLElement>();
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
let historyFeatureEnabled = true;
const CHECKER_MARK_SELECTOR = 'stet-mark';
const INPUT_MUTATION_SUPPRESS_MS = 750;
const recentInputAt = new WeakMap<HTMLElement, number>();
const DISCOVERY_ATTRIBUTE_FILTER = ['style', 'class', 'hidden', 'aria-hidden', 'contenteditable', 'role'];
// let issuePanel: IssuePanelManager | null = null;

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

interface PopupHistoryTargetRecord {
  frameId: number;
  fieldKey: string;
  label: string;
  descriptor: string;
  kind: 'textarea' | 'contenteditable';
  liveEditorAvailable: boolean;
  snapshotCount: number;
  updatedAt: string | null;
  isActive: boolean;
}

interface PopupHistoryTargetsState {
  activeFieldKey: string | null;
  targets: PopupHistoryTargetRecord[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FALLBACK_CONFIG: ResolvedStetConfig = {
  packs: ['common'], language: 'en-GB', role: 'journalist',
  packConfig: { freThreshold: 30, paragraphCharLimit: 320 },
  rules: { enable: [], disable: [] }, dictionaries: [], prompts: {},
  workflows: {}, feedback: { endpoint: null, batchSize: 20, includeContext: false },
  enabled: true, siteAllowlist: [], debounceMs: 200,
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

async function loadHistoryFeatureEnabled(): Promise<boolean> {
  try {
    const historySettings = await new Promise<unknown>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_HISTORY_SETTINGS' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve(resp?.history ?? null);
      });
    });

    return resolveHistoryRuntimeConfig(
      historySettings as Record<string, unknown> | null,
      { hostname: window.location.hostname },
      {
        disableHistory: isHistoryRuntimeDisabled(),
        debug: isHistoryDebugEnabled(false),
      },
    ).enabled;
  } catch {
    return !isHistoryRuntimeDisabled();
  }
}

// ---------------------------------------------------------------------------
// Check + annotate
// ---------------------------------------------------------------------------

/**
 * Extract structured paragraphs from a contenteditable element.
 * Splits on block elements (p, div, br+br) and newlines.
 * First paragraph treated as headline if short (<100 chars).
 */
function extractParagraphs(text: string): { headline?: string; body: string[] } {
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

function getIssues(element: HTMLElement, text = readEditableText(element)): Issue[] {
  if (!config || !config.enabled) return [];
  if (!text.trim()) return [];

  const { headline, body } = extractParagraphs(text);
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

function getIgnoredIssueKeySet(element: HTMLElement): Set<string> {
  let keys = ignoredIssueKeys.get(element);
  if (!keys) {
    keys = new Set<string>();
    ignoredIssueKeys.set(element, keys);
  }
  return keys;
}

function getIgnoredIssueFingerprintSet(element: HTMLElement): Set<string> {
  let fingerprints = ignoredIssueFingerprints.get(element);
  if (!fingerprints) {
    fingerprints = new Set<string>();
    ignoredIssueFingerprints.set(element, fingerprints);
  }
  return fingerprints;
}

function filterIgnoredIssues(element: HTMLElement, issues: Issue[]): Issue[] {
  const ignoredKeys = ignoredIssueKeys.get(element);
  const ignoredFingerprints = ignoredIssueFingerprints.get(element);
  if ((!ignoredKeys || ignoredKeys.size === 0) && (!ignoredFingerprints || ignoredFingerprints.size === 0)) {
    return issues;
  }

  return issues.filter((issue) => {
    if (ignoredKeys?.has(getIssueSelectionKey(issue))) return false;
    if (issue.fingerprint && ignoredFingerprints?.has(issue.fingerprint)) return false;
    return true;
  });
}

function rememberElementIssues(element: HTMLElement, issues: Issue[]) {
  latestIssues.set(element, issues);
  getOrCreateManager(element)?.setIssues(issues);
  // getIssuePanel().updateIssues(element, issues);
}

function publishElementIssues(element: HTMLElement, issues: Issue[]) {
  rememberElementIssues(element, issues);
  syncPageState();
}

function dismissIssueFromConnectedUi(element: HTMLElement, issue: Issue) {
  recentInputAt.set(element, getNow());
  getIgnoredIssueKeySet(element).add(getIssueSelectionKey(issue));
  publishElementIssues(element, filterIgnoredIssues(element, latestIssues.get(element) ?? []));
}

function dismissIssueFamilyFromConnectedUi(element: HTMLElement, fingerprint: string) {
  recentInputAt.set(element, getNow());
  getIgnoredIssueFingerprintSet(element).add(fingerprint);
  publishElementIssues(element, filterIgnoredIssues(element, latestIssues.get(element) ?? []));
}

function clearVisibleIssuesForPendingEdit(element: HTMLElement) {
  const mgr = managers.get(element);
  const issues = latestIssues.get(element) ?? [];
  if (issues.length === 0 && (mgr?.getRenderedMarkCount() ?? 0) === 0) return;

  mgr?.setIssues([]);
  mgr?.clear();
  publishElementIssues(element, []);
}

function runCheckAndAnnotate(element: HTMLElement) {
  if (selfMutating) return;

  if (isCardOpen()) {
    scheduleCheck(element);
    return;
  }

  const startedAt = getNow();
  const text = readEditableText(element);
  if (isGoogleDocsEditableRoot(element)) {
    void rememberGoogleDocsCaret(element, text);
  }
  const mgr = getOrCreateManager(element);
  const beforeMarks = mgr?.getRenderedMarkCount()
    ?? (element.isContentEditable ? element.querySelectorAll(CHECKER_MARK_SELECTOR).length : 0);

  logHistoryEvent('checker:pre-check', {
    ...getCheckerElementLogData(element),
    textLength: text.length,
    beforeMarks,
  });

  console.log(`[stet] Checking <${element.tagName.toLowerCase()}> (${text.length} chars)`);

  const issues = filterIgnoredIssues(element, getIssues(element, text));
  rememberElementIssues(element, issues);

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

  const annotationSupport = getAnnotationSupport(element);
  const canRenderAnnotations = annotationSupport.mode !== 'panel';
  const annotationMode = annotationSupport.mode === 'overlay' ? 'overlay' : 'inline';

  logHistoryEvent('checker:pre-annotate', {
    ...getCheckerElementLogData(element),
    issueCount: issues.length,
    beforeMarks,
    annotationMode: annotationSupport.mode,
  });

  selfMutating = true;
  try {
    if (canRenderAnnotations && mgr) {
      mgr.annotate(issues, annotationMode);
    } else {
      mgr?.clear();
      logHistoryEvent('checker:annotations-skip', {
        ...getCheckerElementLogData(element),
        issueCount: issues.length,
        reason: annotationSupport.reason,
      });
    }
  } finally {
    window.setTimeout(() => { selfMutating = false; }, 0);
  }

  logHistoryEvent('checker:run', {
    ...getCheckerElementLogData(element),
    textLength: text.length,
    issueCount: issues.length,
    beforeMarks,
    afterMarks: mgr?.getRenderedMarkCount()
      ?? (element.isContentEditable ? element.querySelectorAll(CHECKER_MARK_SELECTOR).length : 0),
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
  const timer = setTimeout(() => {
    if (timers.get(element) === timer) {
      timers.delete(element);
    }
    runCheckAndAnnotate(element);
  }, delay);
  timers.set(element, timer);
}

function scheduleInitialCheck(element: HTMLElement, delay = 300) {
  const existing = timers.get(element);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    if (timers.get(element) === timer) {
      timers.delete(element);
    }
    runCheckAndAnnotate(element);
  }, delay);

  timers.set(element, timer);
}

function cleanupTrackedEditable(element: HTMLElement) {
  managers.get(element)?.destroy();
  managers.delete(element);
  trackedEditables.delete(element);
  latestIssues.delete(element);
  // getIssuePanel().removeElement(element);
  const timer = timers.get(element);
  if (timer) clearTimeout(timer);
  timers.delete(element);
}

function getResolvedEditableElement(element: HTMLElement): HTMLElement | null {
  if (element instanceof HTMLTextAreaElement) {
    const mirror = mirrorTextarea(element);
    if (mirror) return mirror;

    const target = getEditableTarget(element);
    if (target) return target.element;
  }

  return element;
}

function collectLiveEditableFieldKeys(root: ParentNode = document): Set<string> {
  const fieldKeys = new Set<string>();

  for (const element of discoverHistoryEditables(root)) {
    const resolved = getResolvedEditableElement(element);
    const target = resolved ? getEditableTarget(resolved) : null;
    if (!target) continue;
    fieldKeys.add(target.fieldKey);
  }

  return fieldKeys;
}

function pruneInactiveTrackedEditables() {
  const liveFieldKeys = collectLiveEditableFieldKeys();

  for (const element of trackedEditables) {
    const target = getEditableTarget(element);
    const isLive = element.isConnected && Boolean(target?.fieldKey && liveFieldKeys.has(target.fieldKey));
    if (isLive) continue;
    cleanupTrackedEditable(element);
  }

  if (activeElement && !trackedEditables.has(activeElement)) {
    activeElement = null;
  }

  if (lastHistoryElement) {
    const target = getEditableTarget(lastHistoryElement);
    if (!lastHistoryElement.isConnected || !target?.fieldKey || !liveFieldKeys.has(target.fieldKey)) {
      lastHistoryElement = null;
    }
  }
}

function pruneDisconnectedElements() {
  for (const element of trackedEditables) {
    if (element.isConnected) continue;
    cleanupTrackedEditable(element);
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
  pruneInactiveTrackedEditables();

  let total = 0;
  for (const [element, issues] of latestIssues) {
    if (!element.isConnected) continue;
    total += issues.length;
  }
  return total;
}

function syncPageState() {
  // getIssuePanel().setActiveElement(getPreferredPopupElement());

  try {
    chrome.runtime.sendMessage({
      type: 'SYNC_PAGE_ISSUES',
      state: getPopupIssuesState(),
    });
  } catch {}
}

function getEditorCount(): number {
  pruneDisconnectedElements();
  pruneInactiveTrackedEditables();

  let total = 0;
  for (const element of trackedEditables) {
    if (element.isConnected) total += 1;
  }
  return total;
}

// function getIssuePanel(): IssuePanelManager {
//   if (!issuePanel) {
//     issuePanel = new IssuePanelManager(applySelectedFixes);
//   }
//   return issuePanel;
// }

function getTrackedEditable(start: EventTarget | null): HTMLElement | null {
  const editable = findHistoryEditable(start);
  if (!editable?.isConnected) return null;
  if (!trackedEditables.has(editable)) return null;
  return editable;
}

function getActiveCheckElement(): HTMLElement | null {
  const trackedHistoryElement = getTrackedHistoryElement();
  if (trackedHistoryElement && trackedEditables.has(trackedHistoryElement)) {
    return trackedHistoryElement;
  }

  if (activeElement?.isConnected && trackedEditables.has(activeElement)) {
    return activeElement;
  }
  return null;
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

function getPreferredPopupElement(): HTMLElement | null {
  pruneDisconnectedElements();
  pruneInactiveTrackedEditables();

  const activeCheckElement = getActiveCheckElement();
  if (activeCheckElement) return activeCheckElement;

  for (const [element, issues] of latestIssues) {
    if (element.isConnected && issues.length > 0) return element;
  }

  for (const element of trackedEditables) {
    if (element.isConnected) return element;
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
  const target = getEditableTarget(element);
  const isGoogleDocs = isGoogleDocsEditableRoot(element);

  let text = readEditableText(element);
  let applied = 0;
  let nextLockedStart = Number.POSITIVE_INFINITY;
  let googleDocsApplyFailed = false;

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
    const nextText = `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;

    if (!usedFullReplacement) {
      if (isGoogleDocs) {
        const replaced = await applyGoogleDocsReplacement(
          element,
          range.start,
          range.end,
          replacement,
          text,
        );
        if (!replaced) {
          googleDocsApplyFailed = true;
          break;
        }
      } else if (element.isContentEditable) {
        const replaced = replaceEditableRange(element, range.start, range.end, replacement);
        if (!replaced) {
          usedFullReplacement = true;
        }
      } else {
        usedFullReplacement = true;
      }
    }

    text = usedFullReplacement || isGoogleDocs ? nextText : readEditableText(element);
    nextLockedStart = range.start;
    applied += 1;
  }

  if (applied > 0) {
    if (usedFullReplacement) {
      if (target) {
        target.write(text);
      } else {
        replaceEditableText(element, text);
      }
    } else {
      notifyEditableChanged(element);
    }
    runCheckAndAnnotate(element);
  } else if (googleDocsApplyFailed) {
    runCheckAndAnnotate(element);
  }

  logHistoryEvent('checker:apply', {
    ...getCheckerElementLogData(element),
    selectedCount: selected.length,
    appliedCount: applied,
    usedFullReplacement,
    googleDocsApplyFailed,
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
    currentText: target.read(),
    label: getPopupElementLabel(element),
    record: await loadHistoryRecordForTarget(target),
  };
}

async function getPageHistoryTargets(): Promise<PopupHistoryTargetsState> {
  pruneDisconnectedElements();

  const activeHistoryElement = getTrackedHistoryElement();
  const activeFieldKey = getEditableFieldKey(activeHistoryElement);
  const seen = new Set<string>();
  const targets: PopupHistoryTargetRecord[] = [];

  for (const element of discoverHistoryEditables()) {
    const target = getEditableTarget(element);
    if (!target) continue;
    if (seen.has(target.fieldKey)) continue;
    seen.add(target.fieldKey);

    const record = await loadHistoryRecordForTarget(target);
    const updatedAt = record?.snapshots.at(-1)?.savedAt ?? record?.updatedAt ?? null;

    targets.push({
      frameId: 0,
      fieldKey: target.fieldKey,
      label: target.label,
      descriptor: target.descriptor,
      kind: target.kind,
      liveEditorAvailable: true,
      snapshotCount: record?.snapshots.length ?? 0,
      updatedAt,
      isActive: target.fieldKey === activeFieldKey,
    });
  }

  return {
    activeFieldKey,
    targets: targets.sort((left, right) => {
      const activeDelta = Number(right.isActive) - Number(left.isActive);
      if (activeDelta !== 0) return activeDelta;

      const snapshotDelta = right.snapshotCount - left.snapshotCount;
      if (snapshotDelta !== 0) return snapshotDelta;

      const updatedDelta = Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? '');
      if (Number.isFinite(updatedDelta) && updatedDelta !== 0) return updatedDelta;

      return left.label.localeCompare(right.label);
    }),
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

  const currentText = target.read();
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
    return { ok: false, currentText: target.read(), state: getPopupIssuesState() };
  }

  const startedAt = getNow();
  target.write(snapshot.content);
  const currentText = target.read();
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
  pruneInactiveTrackedEditables();

  const activeHistoryElement = getTrackedHistoryElement();
  if (activeHistoryElement && getEditableFieldKey(activeHistoryElement) === fieldKey) {
    return activeHistoryElement;
  }

  for (const element of trackedEditables) {
    if (element.isConnected && getEditableTarget(element)?.fieldKey === fieldKey) return element;
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

function getTrackableEditable(start: EventTarget | null): HTMLElement | null {
  const editable = findHistoryEditable(start);
  if (!editable?.isConnected) return null;
  return getResolvedEditableElement(editable);
}

function registerLateEditableDiscovery() {
  document.addEventListener('focusin', (event) => {
    const editable = getTrackableEditable(event.target);
    if (!editable) return;

    const wasTracked = trackedEditables.has(editable);
    attachListener(editable);

    if (!wasTracked) {
      activeElement = editable;
      syncPageState();
    }
  }, true);

  document.addEventListener('input', (event) => {
    const editable = getTrackableEditable(event.target);
    if (!editable) return;

    const wasTracked = trackedEditables.has(editable);
    attachListener(editable);

    if (!wasTracked) {
      activeElement = editable;
      recentInputAt.set(editable, getNow());
      scheduleCheck(editable);
      syncPageState();
    }
  }, true);
}

function registerRuntimeHandlers() {
  if (runtimeHandlersRegistered) return;
  runtimeHandlersRegistered = true;

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'RELOAD_CONFIG_AND_RECHECK') {
        loadConfig().then((newConfig) => {
          // Preserve actual registered packs
          const registered = listPacks().map(p => p.id);
          config = { ...newConfig, packs: registered };
          refreshAllChecks();
          syncPageState();
          sendResponse(getPopupIssuesState());
        });
        return true;
      }

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
        if (!historyFeatureEnabled) {
          sendResponse({
            ok: false,
            liveEditorAvailable: false,
            currentText: '',
            label: null,
            record: null,
          });
          return false;
        }

        const fieldKey = typeof message.fieldKey === 'string' ? message.fieldKey : '';
        void getEditorHistoryState(fieldKey).then(sendResponse);
        return true;
      }

      if (message?.type === 'GET_PAGE_HISTORY_TARGETS') {
        if (!historyFeatureEnabled) {
          sendResponse({ activeFieldKey: null, targets: [] });
          return false;
        }

        void getPageHistoryTargets().then(sendResponse);
        return true;
      }

      if (message?.type === 'CAPTURE_EDITOR_SNAPSHOT') {
        if (!historyFeatureEnabled) {
          sendResponse({ ok: false, currentText: '' });
          return false;
        }

        const fieldKey = typeof message.fieldKey === 'string' ? message.fieldKey : '';
        void captureEditorSnapshot(fieldKey).then(sendResponse);
        return true;
      }

      if (message?.type === 'RESTORE_EDITOR_SNAPSHOT') {
        if (!historyFeatureEnabled) {
          sendResponse({
            ok: false,
            currentText: '',
            state: getPopupIssuesState(),
            error: 'Version history is disabled on this site.',
          });
          return false;
        }

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
  pruneInactiveTrackedEditables();
  for (const element of discoverHistoryEditables()) {
    const target = getResolvedEditableElement(element);
    if (!target) continue;
    attachListener(target);
    runCheckAndAnnotate(target);
  }
}

function findEditableForNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node instanceof HTMLElement) {
    return findHistoryEditable(node);
  }
  if (node.parentElement) {
    return findHistoryEditable(node.parentElement);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Element discovery
// ---------------------------------------------------------------------------

function attachListener(el: HTMLElement) {
  if (trackedEditables.has(el)) return;
  trackedEditables.add(el);
  // Disable browser spellcheck — stet handles it
  el.spellcheck = false;
  if (getAnnotationSupport(el).mode !== 'panel') {
    managers.set(el, createAnnotationManager(el));
  }
  logHistoryEvent('checker:attach', getCheckerElementLogData(el));

  el.addEventListener('input', () => {
    if (selfMutating) return;
    recentInputAt.set(el, getNow());
    recordHistoryEventRate('checker:input', getCheckerElementLogData(el));
    scheduleCheck(el);
  });

  el.addEventListener('focus', () => {
    activeElement = el;
    if (isGoogleDocsEditableRoot(el)) {
      void rememberGoogleDocsCaret(el);
    }
    logHistoryEvent('checker:focus', getCheckerElementLogData(el));
    syncPageState();
  });

  el.addEventListener('mouseup', () => {
    if (isGoogleDocsEditableRoot(el)) {
      void rememberGoogleDocsCaret(el);
    }
  });

  scheduleInitialCheck(el);
}

function createAnnotationManager(element: HTMLElement): AnnotationManager {
  return new AnnotationManager(element, {
    onApplyIssue: (issue) => {
      return applySelectedFixes(element, [getIssueSelectionKey(issue)])
        .then((applied) => applied > 0);
    },
    onIgnoreIssue: (issue) => {
      dismissIssueFromConnectedUi(element, issue);
    },
    onIgnoreIssueFamily: (fingerprint) => {
      dismissIssueFamilyFromConnectedUi(element, fingerprint);
    },
  });
}

function getOrCreateManager(element: HTMLElement): AnnotationManager | null {
  if (getAnnotationSupport(element).mode === 'panel') return null;

  let mgr = managers.get(element);
  if (!mgr) {
    mgr = createAnnotationManager(element);
    managers.set(element, mgr);
  }
  return mgr;
}

function discoverEditables() {
  pruneDisconnectedElements();
  pruneInactiveTrackedEditables();
  const editables = discoverHistoryEditables();
  const resolved: HTMLElement[] = [];
  for (const el of editables) {
    const target = getResolvedEditableElement(el);
    if (target) resolved.push(target);
  }
  resolved.forEach(attachListener);
  logHistoryEvent('checker:discover', {
    hostname: window.location.hostname,
    count: resolved.length,
  });
  syncPageState();
}

/**
 * Create a contenteditable mirror for a textarea.
 * Returns the mirror element, or null if mirroring failed.
 */
function mirrorTextarea(textarea: HTMLTextAreaElement): HTMLElement | null {
  if (isMirroredTextarea(textarea)) {
    console.log('[stet] textarea already mirrored:', textarea.id || textarea.name || '(anon)');
    return null;
  }
  console.log('[stet] mirroring textarea:', textarea.id || textarea.name || '(anon)',
    `${textarea.offsetWidth}x${textarea.offsetHeight}`);
  const mirror = createTextareaMirror(textarea);
  if (!mirror) {
    console.warn('[stet] textarea mirror creation failed:', textarea.id || textarea.name || '(anon)');
    return null;
  }
  console.log('[stet] textarea mirror created:', textarea.id || textarea.name || '(anon)');
  logHistoryEvent('checker:textarea-mirror', {
    id: textarea.id || null,
    name: textarea.name || null,
  });
  return mirror;
}

function isStetOwnedNode(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return false;
  return !!el.closest('.stet-overlay-root, .stet-history-root, .stet-card');
}

function isGoogleDocsChromeNode(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return false;
  return !!el.closest('.kix-cursor, .kix-cursor-caret, .kix-selection-overlay');
}

function shouldIgnoreMutation(mutation: MutationRecord): boolean {
  if (isStetOwnedNode(mutation.target)) return true;

  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  if (changedNodes.length > 0 && changedNodes.every((node) => isGoogleDocsChromeNode(node))) {
    return true;
  }

  if (!isGoogleDocsChromeNode(mutation.target)) return false;
  return changedNodes.every((node) => isGoogleDocsChromeNode(node));
}

function observeDOM() {
  if (domObserver) return;

  domObserver = new MutationObserver((mutations) => {
    if (selfMutating) return;

    // Filter out mutations targeting stet's own DOM and Google Docs cursor
    // chrome so re-checks only happen on actual content changes.
    const filtered = mutations.filter((m) => !shouldIgnoreMutation(m));
    if (filtered.length === 0) return;

    const trackedBeforePrune = trackedEditables.size;
    pruneDisconnectedElements();
    const changedEditables = new Set<HTMLElement>();

    for (const mutation of filtered) {
      const mutationEditable = findEditableForNode(mutation.target);
      if (mutationEditable) changedEditables.add(mutationEditable);

      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        const directEditable = getTrackableEditable(mutation.target);
        if (directEditable) {
          attachListener(directEditable);
          changedEditables.add(directEditable);
        }

        discoverHistoryEditables(mutation.target).forEach((disc) => {
          const discovered = getResolvedEditableElement(disc);
          if (!discovered) return;
          attachListener(discovered);
          changedEditables.add(discovered);
        });
      }

      for (const node of mutation.addedNodes) {
        if (isStetOwnedNode(node)) continue;
        const changedEditable = findEditableForNode(node);
        if (changedEditable) changedEditables.add(changedEditable);

        if (node instanceof HTMLElement) {
          const editable = getTrackableEditable(node);
          if (editable) attachListener(editable);
          discoverHistoryEditables(node).forEach((disc) => {
            const discovered = getResolvedEditableElement(disc);
            if (!discovered) return;
            attachListener(discovered);
            changedEditables.add(discovered);
          });
        }
      }
    }

    pruneInactiveTrackedEditables();
    const prunedTrackedEditables = trackedEditables.size !== trackedBeforePrune;

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
      mutationCount: filtered.length,
      changedEditableCount: changedEditables.size,
    });
    if (prunedTrackedEditables || changedEditables.size > 0) {
      syncPageState();
    }
  });
  domObserver.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: DISCOVERY_ATTRIBUTE_FILTER,
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
  historyFeatureEnabled = await loadHistoryFeatureEnabled();

  // Override config packs with whatever is actually registered
  const registered = listPacks().map(p => p.id);
  config = { ...config, packs: registered };

  // If bt-pack is active, disable common spell check (bt-pack's is more complete)
  if (registered.includes('bt')) {
    const disabled = config.rules?.disable ?? [];
    if (!disabled.includes('COMMON-SPELL-01')) {
      config = { ...config, rules: { ...config.rules, disable: [...disabled, 'COMMON-SPELL-01'] } };
    }
  }

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
  registerLateEditableDiscovery();
  registerRuntimeHandlers();
  if (historyFeatureEnabled) {
    registerHistoryTracking();
  }
  activeElement = getTrackedEditable(document.activeElement);
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
