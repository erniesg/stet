/**
 * Background service worker for the Stet extension.
 * Handles: settings, FX rate caching, badge updates, LLM proxy.
 */

import { loadSettings, saveSettings, getEffectiveConfig, DEFAULT_STORED_SETTINGS } from '../storage/settings.js';

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
}

function clearTabIssueState(tabId: number) {
  tabIssueStates.delete(tabId);
  setBadgeForTab(tabId, 0);
  broadcastTabIssueState(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabIssueStates.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearTabIssueState(tabId);
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
          enabled: Boolean(message.state?.enabled),
          totalIssues: Number(message.state?.totalIssues) || 0,
          editorCount: Number(message.state?.editorCount) || 0,
          activeFieldKey: typeof message.state?.activeFieldKey === 'string' ? message.state.activeFieldKey : null,
          activeLabel: typeof message.state?.activeLabel === 'string' ? message.state.activeLabel : null,
          issues: Array.isArray(message.state?.issues) ? message.state.issues : [],
          updatedAt: Date.now(),
        });
        syncBadgeFromState(tabId);
      }
      sendResponse({ ok: true });
      return false;

    case 'GET_TAB_ISSUES':
      if (typeof message.tabId === 'number') {
        sendResponse(getTabIssueState(message.tabId));
        return false;
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
