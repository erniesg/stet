/**
 * Background service worker for the Stet extension.
 * Handles: settings, FX rate caching, badge updates, LLM proxy.
 */

import { loadSettings, saveSettings, getEffectiveConfig, DEFAULT_STORED_SETTINGS } from '../storage/settings.js';

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Stet] Style checker installed');

  // Initialize storage with defaults if first install
  const current = await loadSettings();
  if (!current.resolvedConfig) {
    await saveSettings(DEFAULT_STORED_SETTINGS);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

    case 'UPDATE_BADGE':
      chrome.action.setBadgeText({ text: String(message.count || ''), tabId: message.tabId });
      chrome.action.setBadgeBackgroundColor({ color: message.count > 0 ? '#e74c3c' : '#2ecc71' });
      break;
  }
});
