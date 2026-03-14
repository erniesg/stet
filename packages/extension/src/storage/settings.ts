/**
 * Extension settings — consumes ResolvedStetConfig from the core engine.
 *
 * The extension stores two things in chrome.storage:
 *   1. A resolved newsroom config (from stet.config.yaml, pre-resolved at build time)
 *   2. Per-user overrides (role, disabled rules, site allowlist)
 *
 * At runtime, user overrides are layered on top of the resolved config
 * via applyUserOverrides() from stet.
 */

import type { ResolvedStetConfig, UserOverrides } from 'stet';
import { DEFAULT_RESOLVED_CONFIG, applyUserOverrides } from 'stet';

// Re-export types for extension consumers
export type { ResolvedStetConfig, UserOverrides };

/** What we persist in chrome.storage.sync */
export interface StoredSettings {
  /** Pre-resolved newsroom config (set at install or via options page) */
  resolvedConfig: ResolvedStetConfig;
  /** Per-user overrides layered on top */
  userOverrides: UserOverrides;
}

/** Default stored settings — common pack only, no overrides */
export const DEFAULT_STORED_SETTINGS: StoredSettings = {
  resolvedConfig: DEFAULT_RESOLVED_CONFIG,
  userOverrides: {},
};

/** Load settings from chrome.storage.sync */
export async function loadSettings(): Promise<StoredSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_STORED_SETTINGS, (result) => {
      resolve(result as StoredSettings);
    });
  });
}

/** Save settings to chrome.storage.sync */
export async function saveSettings(settings: Partial<StoredSettings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, resolve);
  });
}

/** Get the effective config (resolved + user overrides applied) */
export async function getEffectiveConfig(): Promise<ResolvedStetConfig> {
  const { resolvedConfig, userOverrides } = await loadSettings();
  return applyUserOverrides(resolvedConfig, userOverrides);
}

/** Update user overrides (partial merge) */
export async function updateUserOverrides(patch: Partial<UserOverrides>): Promise<void> {
  const { userOverrides } = await loadSettings();
  await saveSettings({
    userOverrides: { ...userOverrides, ...patch },
  });
}

