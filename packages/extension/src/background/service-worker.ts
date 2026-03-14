/**
 * Background service worker for the Stet extension.
 * Handles: settings, FX rate caching, badge updates, LLM proxy.
 */

import {
  loadSettings,
  saveSettings,
  getEffectiveConfig,
  getHistorySettings,
  DEFAULT_STORED_SETTINGS,
} from '../storage/settings.js';

interface PopupIssueRecord {
  key: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  originalText: string;
  suggestion: string | null | undefined;
  description: string;
  canFix: boolean;
}

interface FrameIssueState {
  enabled: boolean;
  totalIssues: number;
  editorCount: number;
  activeFieldKey: string | null;
  activeLabel: string | null;
  issues: PopupIssueRecord[];
  updatedAt: number;
}

interface TabIssueState {
  enabled: boolean;
  totalIssues: number;
  editorCount: number;
  activeFrameId: number | null;
  activeFieldKey: string | null;
  activeLabel: string | null;
  issues: PopupIssueRecord[];
}

interface HistoryDebugStorageRecord {
  tabId: number;
  frameId: number;
  href: string;
  updatedAt: string;
  entries: Array<{
    event: string;
    timestamp: string;
    href: string;
    data: Record<string, unknown>;
  }>;
}

interface PageDebugEvent {
  pageEventType: string;
  href: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface TraceEventEntry {
  source: 'history' | 'page';
  event: string;
  timestamp: string;
  href: string;
  data: Record<string, unknown>;
  tabId: number | null;
  frameId: number | null;
}

const EMPTY_TAB_ISSUES: TabIssueState = {
  enabled: false,
  totalIssues: 0,
  editorCount: 0,
  activeFrameId: null,
  activeFieldKey: null,
  activeLabel: null,
  issues: [],
};

const tabIssueStates = new Map<number, Map<number, FrameIssueState>>();
const TAB_ISSUE_STORAGE_PREFIX = 'stet:tab:issues:';
const historyDebugKeysByTab = new Map<number, Set<string>>();
const HISTORY_DEBUG_STORAGE_PREFIX = 'stet:history:debug:';
const HISTORY_DEBUG_LATEST_KEY = 'stet:history:debug:last';
const PAGE_DEBUG_LATEST_KEY = 'stet:page:debug:last';
const TRACE_STORAGE_KEY = 'stet:trace:events';
const TRACE_MAX_ENTRIES = 2000;
const TRACE_FILE_ENDPOINT = 'http://127.0.0.1:5123/trace';
let traceEntriesCache: TraceEventEntry[] | null = null;
let traceWriteChain: Promise<void> = Promise.resolve();

function getIssueStateStorageArea(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

function getTabIssueStorageKey(tabId: number): string {
  return `${TAB_ISSUE_STORAGE_PREFIX}${tabId}`;
}

function setBadgeForTab(tabId: number, count: number) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
  chrome.action.setBadgeBackgroundColor({
    color: count > 0 ? '#e74c3c' : '#2ecc71',
    tabId,
  });
}

function broadcastTabIssueState(tabId: number) {
  try {
    chrome.runtime.sendMessage({
      type: 'TAB_ISSUES_UPDATED',
      tabId,
      state: getTabIssueState(tabId),
    }, () => {
      void chrome.runtime.lastError;
    });
  } catch {}
}

function getFrameStates(tabId: number): Map<number, FrameIssueState> {
  let states = tabIssueStates.get(tabId);
  if (!states) {
    states = new Map<number, FrameIssueState>();
    tabIssueStates.set(tabId, states);
  }
  return states;
}

function normalizeFrameIssueState(raw: unknown): FrameIssueState | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const candidate = raw as Partial<FrameIssueState>;
  return {
    enabled: Boolean(candidate.enabled),
    totalIssues: Number(candidate.totalIssues) || 0,
    editorCount: Number(candidate.editorCount) || 0,
    activeFieldKey: typeof candidate.activeFieldKey === 'string' ? candidate.activeFieldKey : null,
    activeLabel: typeof candidate.activeLabel === 'string' ? candidate.activeLabel : null,
    issues: Array.isArray(candidate.issues) ? candidate.issues : [],
    updatedAt: Number(candidate.updatedAt) || 0,
  };
}

function serializeFrameStates(states: Map<number, FrameIssueState>): Record<string, FrameIssueState> {
  const serialized: Record<string, FrameIssueState> = {};
  for (const [frameId, state] of states) {
    serialized[String(frameId)] = state;
  }
  return serialized;
}

function parseStoredFrameStates(rawStates: unknown): Map<number, FrameIssueState> {
  const hydrated = new Map<number, FrameIssueState>();

  if (typeof rawStates !== 'object' || rawStates === null) {
    return hydrated;
  }

  for (const [frameId, state] of Object.entries(rawStates as Record<string, unknown>)) {
    const normalized = normalizeFrameIssueState(state);
    const parsedFrameId = Number(frameId);
    if (!normalized || !Number.isInteger(parsedFrameId)) continue;
    hydrated.set(parsedFrameId, normalized);
  }

  return hydrated;
}

async function persistTabIssueState(tabId: number): Promise<void> {
  const states = tabIssueStates.get(tabId);
  const storage = getIssueStateStorageArea();
  const storageKey = getTabIssueStorageKey(tabId);

  if (!states || states.size === 0) {
    await new Promise<void>((resolve) => {
      storage.remove(storageKey, () => resolve());
    });
    return;
  }

  await new Promise<void>((resolve) => {
    storage.set({
      [storageKey]: serializeFrameStates(states),
    }, () => resolve());
  });
}

async function loadPersistedTabIssueState(tabId: number): Promise<Map<number, FrameIssueState>> {
  const existing = tabIssueStates.get(tabId);
  if (existing && existing.size > 0) return existing;

  const storageKey = getTabIssueStorageKey(tabId);
  const storage = getIssueStateStorageArea();

  const stored = await new Promise<Record<string, unknown>>((resolve) => {
    storage.get(storageKey, (result) => resolve(result));
  });

  const hydrated = parseStoredFrameStates(stored[storageKey]);

  if (hydrated.size > 0) {
    tabIssueStates.set(tabId, hydrated);
    return hydrated;
  }

  return getFrameStates(tabId);
}

async function restorePersistedBadges(): Promise<void> {
  const storage = getIssueStateStorageArea();
  const stored = await new Promise<Record<string, unknown>>((resolve) => {
    storage.get(null, (result) => resolve(result));
  });

  for (const [storageKey, rawStates] of Object.entries(stored)) {
    if (!storageKey.startsWith(TAB_ISSUE_STORAGE_PREFIX)) continue;

    const tabId = Number(storageKey.slice(TAB_ISSUE_STORAGE_PREFIX.length));
    if (!Number.isInteger(tabId)) continue;

    const hydrated = parseStoredFrameStates(rawStates);
    if (hydrated.size === 0) {
      continue;
    }

    tabIssueStates.set(tabId, hydrated);
    setBadgeForTab(tabId, getTabIssueState(tabId).totalIssues);
  }
}

function pickPreferredFrame(states: Map<number, FrameIssueState>): [number, FrameIssueState] | null {
  let preferred: [number, FrameIssueState] | null = null;

  for (const entry of states) {
    const [, state] = entry;
    if (!preferred) {
      preferred = entry;
      continue;
    }

    const [, current] = preferred;
    const currentRank = getFrameRank(current);
    const nextRank = getFrameRank(state);

    if (nextRank > currentRank || (nextRank === currentRank && state.updatedAt > current.updatedAt)) {
      preferred = entry;
    }
  }

  return preferred;
}

function getFrameRank(state: FrameIssueState): number {
  if (state.activeFieldKey) return 3;
  if (state.totalIssues > 0 || state.issues.length > 0) return 2;
  if (state.editorCount > 0) return 1;
  return 0;
}

function getTabIssueState(tabId: number): TabIssueState {
  const states = tabIssueStates.get(tabId);
  if (!states || states.size === 0) return EMPTY_TAB_ISSUES;

  let enabled = false;
  let totalIssues = 0;
  let editorCount = 0;

  for (const [, state] of states) {
    enabled = enabled || state.enabled;
    totalIssues += state.totalIssues;
    editorCount += state.editorCount;
  }

  const preferred = pickPreferredFrame(states);
  if (!preferred) {
    return { ...EMPTY_TAB_ISSUES, enabled, totalIssues, editorCount };
  }

  const [activeFrameId, activeState] = preferred;
  return {
    enabled,
    totalIssues,
    editorCount,
    activeFrameId,
    activeFieldKey: activeState.activeFieldKey,
    activeLabel: activeState.activeLabel,
    issues: activeState.issues,
  };
}

function syncBadgeFromState(tabId: number) {
  setBadgeForTab(tabId, getTabIssueState(tabId).totalIssues);
  broadcastTabIssueState(tabId);
  void persistTabIssueState(tabId);
}

function clearTabIssueState(tabId: number) {
  tabIssueStates.delete(tabId);
  setBadgeForTab(tabId, 0);
  broadcastTabIssueState(tabId);
  void persistTabIssueState(tabId);
}

function getHistoryDebugStorageKey(tabId: number, frameId: number): string {
  return `${HISTORY_DEBUG_STORAGE_PREFIX}${tabId}:${frameId}`;
}

function rememberHistoryDebugKey(tabId: number, key: string) {
  let keys = historyDebugKeysByTab.get(tabId);
  if (!keys) {
    keys = new Set<string>();
    historyDebugKeysByTab.set(tabId, keys);
  }
  keys.add(key);
}

function clearHistoryDebugBuffers(tabId: number) {
  const keys = historyDebugKeysByTab.get(tabId);
  if (!keys || keys.size === 0) return;

  chrome.storage.local.remove([...keys]);
  historyDebugKeysByTab.delete(tabId);
}

function getRefreshFrameIds(tabId: number): number[] {
  const states = tabIssueStates.get(tabId);
  const orderedFrameIds = states
    ? [...states.entries()]
      .sort((left, right) => {
        const rankDelta = getFrameRank(right[1]) - getFrameRank(left[1]);
        if (rankDelta !== 0) return rankDelta;
        return right[1].updatedAt - left[1].updatedAt;
      })
      .map(([frameId]) => frameId)
    : [];

  if (!orderedFrameIds.includes(0)) {
    orderedFrameIds.push(0);
  }

  return orderedFrameIds.length > 0 ? orderedFrameIds : [0];
}

function requestFrameIssueState(tabId: number, frameId: number): Promise<FrameIssueState | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'GET_PAGE_ISSUES' },
      { frameId },
      (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }

        const normalized = normalizeFrameIssueState(resp);
        if (!normalized) {
          resolve(null);
          return;
        }

        resolve({
          ...normalized,
          updatedAt: Date.now(),
        });
      },
    );
  });
}

async function refreshTabIssueState(tabId: number): Promise<TabIssueState> {
  await loadPersistedTabIssueState(tabId);
  const frameIds = getRefreshFrameIds(tabId);
  const failedFrameIds: number[] = [];
  let refreshed = false;

  for (const frameId of frameIds) {
    const state = await requestFrameIssueState(tabId, frameId);
    if (!state) {
      failedFrameIds.push(frameId);
      continue;
    }

    getFrameStates(tabId).set(frameId, state);
    refreshed = true;
  }

  if (refreshed && failedFrameIds.length > 0) {
    const states = getFrameStates(tabId);
    for (const frameId of failedFrameIds) {
      states.delete(frameId);
    }
  }

  if (refreshed) {
    syncBadgeFromState(tabId);
    return getTabIssueState(tabId);
  }

  await loadPersistedTabIssueState(tabId);
  return getTabIssueState(tabId);
}

function loadTraceEntries(): Promise<TraceEventEntry[]> {
  if (traceEntriesCache) {
    return Promise.resolve(traceEntriesCache);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(TRACE_STORAGE_KEY, (result) => {
      const stored = Array.isArray(result[TRACE_STORAGE_KEY]) ? result[TRACE_STORAGE_KEY] : [];
      traceEntriesCache = stored.filter((entry): entry is TraceEventEntry => (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { event?: unknown }).event === 'string' &&
        typeof (entry as { timestamp?: unknown }).timestamp === 'string' &&
        typeof (entry as { href?: unknown }).href === 'string' &&
        typeof (entry as { source?: unknown }).source === 'string' &&
        typeof (entry as { data?: unknown }).data === 'object' &&
        (entry as { data?: unknown }).data !== null
      ));
      resolve(traceEntriesCache);
    });
  });
}

function appendTraceEntry(entry: TraceEventEntry) {
  traceWriteChain = traceWriteChain.then(async () => {
    const entries = await loadTraceEntries();
    entries.push(entry);
    if (entries.length > TRACE_MAX_ENTRIES) {
      entries.splice(0, entries.length - TRACE_MAX_ENTRIES);
    }

    traceEntriesCache = entries;
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({
        [TRACE_STORAGE_KEY]: entries,
      }, () => resolve());
    });
  });

  void postTraceEntryToCollector(entry);
}

async function postTraceEntryToCollector(entry: TraceEventEntry) {
  try {
    await fetch(TRACE_FILE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(entry),
    });
  } catch {}
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabIssueStates.delete(tabId);
  clearHistoryDebugBuffers(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearTabIssueState(tabId);
    clearHistoryDebugBuffers(tabId);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Stet] Style checker installed');

  // Initialize storage with defaults if first install
  const current = await loadSettings();
  if (!current.resolvedConfig) {
    await saveSettings(DEFAULT_STORED_SETTINGS);
  }
});

void restorePersistedBadges();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_SETTINGS':
      // Return the effective config (resolved + user overrides)
      getEffectiveConfig().then((config) => sendResponse({ config }));
      return true; // async response

    case 'GET_RAW_SETTINGS':
      // Return the raw stored settings (for options page)
      loadSettings().then((settings) => sendResponse(settings));
      return true;

    case 'GET_HISTORY_SETTINGS':
      getHistorySettings().then((history) => sendResponse({ history }));
      return true;

    case 'PAGE_DEBUG_EVENT':
      if (typeof sender.tab?.id === 'number') {
        const event: PageDebugEvent = {
          pageEventType: typeof message.event?.pageEventType === 'string' ? message.event.pageEventType : 'unknown',
          href: typeof message.event?.href === 'string' ? message.event.href : sender.tab.url ?? '',
          timestamp: typeof message.event?.timestamp === 'string' ? message.event.timestamp : new Date().toISOString(),
          payload: typeof message.event?.payload === 'object' && message.event.payload !== null
            ? message.event.payload
            : {},
        };

        chrome.storage.local.set({
          [PAGE_DEBUG_LATEST_KEY]: {
            tabId: sender.tab.id,
            frameId: sender.frameId ?? 0,
            ...event,
          },
        });

        if (event.pageEventType === 'console-error' || event.pageEventType === 'window-error') {
          console.error(formatPageDebugConsoleMessage(event));
        } else {
          console.warn(formatPageDebugConsoleMessage(event));
        }

        appendTraceEntry({
          source: 'page',
          event: event.pageEventType,
          timestamp: event.timestamp,
          href: event.href,
          data: event.payload,
          tabId: sender.tab.id,
          frameId: sender.frameId ?? 0,
        });
      }
      sendResponse({ ok: true });
      return false;

    case 'TRACE_EVENT':
      appendTraceEntry({
        source: message.source === 'page' ? 'page' : 'history',
        event: typeof message.entry?.event === 'string' ? message.entry.event : 'unknown',
        timestamp: typeof message.entry?.timestamp === 'string'
          ? message.entry.timestamp
          : new Date().toISOString(),
        href: typeof message.entry?.href === 'string'
          ? message.entry.href
          : sender.tab?.url ?? '',
        data: typeof message.entry?.data === 'object' && message.entry.data !== null
          ? message.entry.data
          : {},
        tabId: typeof sender.tab?.id === 'number' ? sender.tab.id : null,
        frameId: sender.frameId ?? 0,
      });
      sendResponse({ ok: true });
      return false;

    case 'SYNC_HISTORY_DEBUG_BUFFER':
      if (
        typeof sender.tab?.id === 'number' &&
        Array.isArray(message.payload?.entries)
      ) {
        const tabId = sender.tab.id;
        const frameId = sender.frameId ?? 0;
        const storageKey = getHistoryDebugStorageKey(tabId, frameId);
        const record: HistoryDebugStorageRecord = {
          tabId,
          frameId,
          href: typeof message.payload?.href === 'string' ? message.payload.href : '',
          updatedAt: typeof message.payload?.updatedAt === 'string'
            ? message.payload.updatedAt
            : new Date().toISOString(),
          entries: message.payload.entries
            .filter((entry: unknown): entry is HistoryDebugStorageRecord['entries'][number] => (
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as { event?: unknown }).event === 'string' &&
              typeof (entry as { timestamp?: unknown }).timestamp === 'string' &&
              typeof (entry as { href?: unknown }).href === 'string' &&
              typeof (entry as { data?: unknown }).data === 'object' &&
              (entry as { data?: unknown }).data !== null
            ))
            .slice(-120),
        };

        rememberHistoryDebugKey(tabId, storageKey);
        chrome.storage.local.set({
          [storageKey]: record,
          [HISTORY_DEBUG_LATEST_KEY]: record,
        });
      }
      sendResponse({ ok: true });
      return false;

    case 'GET_HISTORY_DEBUG_BUFFER': {
      if (message.latest === true) {
        chrome.storage.local.get(HISTORY_DEBUG_LATEST_KEY, (result) => {
          sendResponse({ ok: true, record: result[HISTORY_DEBUG_LATEST_KEY] ?? null });
        });
        return true;
      }

      const tabId = typeof message.tabId === 'number' ? message.tabId : sender.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, record: null });
        return false;
      }

      const preferredFrameId = getTabIssueState(tabId).activeFrameId ?? 0;
      const frameId = typeof message.frameId === 'number' ? message.frameId : preferredFrameId;
      const storageKey = getHistoryDebugStorageKey(tabId, frameId);
      chrome.storage.local.get(storageKey, (result) => {
        sendResponse({ ok: true, record: result[storageKey] ?? null });
      });
      return true;
    }

    case 'UPDATE_USER_OVERRIDES':
      // Partial-merge user overrides
      loadSettings().then(async ({ userOverrides }) => {
        await saveSettings({
          userOverrides: { ...userOverrides, ...message.overrides },
        });
        sendResponse({ ok: true });
      });
      return true;

    case 'SET_RESOLVED_CONFIG':
      // Replace the resolved newsroom config (e.g., from options page import)
      saveSettings({ resolvedConfig: message.config }).then(() => {
        sendResponse({ ok: true });
      });
      return true;

    case 'SYNC_PAGE_ISSUES':
      if (typeof sender.tab?.id === 'number') {
        const tabId = sender.tab.id;
        const frameId = sender.frameId ?? 0;
        getFrameStates(tabId).set(frameId, {
          ...(normalizeFrameIssueState(message.state) ?? {
            enabled: false,
            totalIssues: 0,
            editorCount: 0,
            activeFieldKey: null,
            activeLabel: null,
            issues: [],
            updatedAt: 0,
          }),
          updatedAt: Date.now(),
        } satisfies FrameIssueState);
        syncBadgeFromState(tabId);
      }
      sendResponse({ ok: true });
      return false;

    case 'GET_TAB_ISSUES':
      if (typeof message.tabId === 'number') {
        void loadPersistedTabIssueState(message.tabId).then(() => {
          sendResponse(getTabIssueState(message.tabId));
        });
        return true;
      }
      sendResponse(EMPTY_TAB_ISSUES);
      return false;

    case 'REFRESH_TAB_ISSUES':
      if (typeof message.tabId === 'number') {
        void refreshTabIssueState(message.tabId).then(sendResponse);
        return true;
      }
      sendResponse(EMPTY_TAB_ISSUES);
      return false;

    case 'APPLY_TAB_ISSUES':
      if (typeof message.tabId !== 'number' || typeof message.frameId !== 'number') {
        sendResponse({ ok: false, applied: 0, state: EMPTY_TAB_ISSUES });
        return false;
      }

      chrome.tabs.sendMessage(
        message.tabId,
        {
          type: 'APPLY_EDITOR_ISSUES',
          fieldKey: message.fieldKey,
          issueKeys: message.issueKeys,
        },
        { frameId: message.frameId },
        (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              applied: 0,
              state: getTabIssueState(message.tabId),
            });
            return;
          }

          if (resp?.state) {
            getFrameStates(message.tabId).set(message.frameId, {
              enabled: Boolean(resp.state.enabled),
              totalIssues: Number(resp.state.totalIssues) || 0,
              editorCount: Number(resp.state.editorCount) || 0,
              activeFieldKey: typeof resp.state.activeFieldKey === 'string' ? resp.state.activeFieldKey : null,
              activeLabel: typeof resp.state.activeLabel === 'string' ? resp.state.activeLabel : null,
              issues: Array.isArray(resp.state.issues) ? resp.state.issues : [],
              updatedAt: Date.now(),
            });
            syncBadgeFromState(message.tabId);
          }

          sendResponse({
            ok: Boolean(resp?.ok),
            applied: Number(resp?.applied) || 0,
            state: getTabIssueState(message.tabId),
          });
        },
      );
      return true;

    case 'UPDATE_BADGE':
      if (typeof message.tabId === 'number') {
        setBadgeForTab(message.tabId, message.count || 0);
        break;
      }

      if (typeof sender.tab?.id === 'number') {
        setBadgeForTab(sender.tab.id, message.count || 0);
        break;
      }

      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: message.count > 0 ? '#e74c3c' : '#2ecc71' });
      break;
  }
});

function formatPageDebugConsoleMessage(event: PageDebugEvent): string {
  const message = getPageDebugMessage(event.payload);
  return message
    ? `[Stet/page] ${event.pageEventType} ${message}`
    : `[Stet/page] ${event.pageEventType}`;
}

function getPageDebugMessage(payload: Record<string, unknown>): string | null {
  const args = Array.isArray(payload.args) ? payload.args : [];
  for (const value of args) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'object' && value !== null) {
      const objectValue = value as Record<string, unknown>;
      if (typeof objectValue.message === 'string' && objectValue.message.trim().length > 0) {
        return objectValue.message.trim();
      }
    }
  }

  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message.trim();
  }

  return null;
}
