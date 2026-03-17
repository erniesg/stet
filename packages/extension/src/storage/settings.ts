/**
 * Extension settings — consumes ResolvedStetConfig from the core engine.
 *
 * The extension stores two things in chrome.storage:
 *   1. A resolved newsroom config (from stet.config.yaml, pre-resolved at build time)
 *   2. Per-user overrides (profile, language, role, disabled rules, site allowlist)
 *
 * At runtime, user overrides are layered on top of the resolved config
 * via applyUserOverrides() from stet.
 */

import type { Language, ResolvedStetConfig, UserOverrides as CoreUserOverrides } from 'stet';
import { DEFAULT_RESOLVED_CONFIG, applyUserOverrides } from 'stet';
import {
  DEFAULT_HISTORY_SETTINGS,
  normalizeHistorySettings,
  type HistorySettings,
} from '../history-settings.js';
import { getDefaultSiteAllowlist, normalizeSiteAllowlist } from '../host-access.js';
import {
  applyProfileToConfig,
  getActiveProfileId,
  isSupportedLanguage,
  normalizeProfileId,
} from './profiles.js';

// Re-export types for extension consumers
export type { ResolvedStetConfig };

export interface UserOverrides extends CoreUserOverrides {
  language?: Language;
  profileId?: string;
}

/** What we persist in chrome.storage.sync */
export interface StoredSettings {
  /** Pre-resolved newsroom config (set at install or via options page) */
  resolvedConfig: ResolvedStetConfig;
  /** Per-user overrides layered on top */
  userOverrides: UserOverrides;
  /** Version-history specific controls */
  history: HistorySettings;
}

/** Default stored settings — common pack only, no overrides */
export const DEFAULT_STORED_SETTINGS: StoredSettings = {
  resolvedConfig: DEFAULT_RESOLVED_CONFIG,
  userOverrides: {
    siteAllowlist: getDefaultSiteAllowlist(),
  },
  history: DEFAULT_HISTORY_SETTINGS,
};

/** Load settings from chrome.storage.sync */
export async function loadSettings(): Promise<StoredSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_STORED_SETTINGS as unknown as Record<string, unknown>, (result) => {
      const raw = result as Partial<StoredSettings>;
      resolve({
        resolvedConfig: raw.resolvedConfig ?? DEFAULT_STORED_SETTINGS.resolvedConfig,
        userOverrides: normalizeUserOverrides(raw.userOverrides),
        history: normalizeHistorySettings(raw.history),
      });
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
  const profiledConfig = applyProfileToConfig(
    resolvedConfig,
    getActiveProfileId(userOverrides.profileId, resolvedConfig),
  );
  return applyUserOverrides(profiledConfig, userOverrides);
}

/** Get version-history specific settings */
export async function getHistorySettings(): Promise<HistorySettings> {
  const { history } = await loadSettings();
  return normalizeHistorySettings(history);
}

/** Update user overrides (partial merge) */
export async function updateUserOverrides(patch: Partial<UserOverrides>): Promise<void> {
  const { userOverrides } = await loadSettings();
  await saveSettings({
    userOverrides: normalizeUserOverrides({ ...userOverrides, ...patch }),
  });
}

function normalizeUserOverrides(overrides?: Partial<UserOverrides> | null): UserOverrides {
  const normalizedOverrides = overrides ? { ...overrides } : {};
  const profileId = normalizeProfileId(normalizedOverrides.profileId);
  const language = isSupportedLanguage(normalizedOverrides.language)
    ? normalizedOverrides.language
    : undefined;

  return {
    ...normalizedOverrides,
    language,
    profileId: profileId ?? undefined,
    siteAllowlist: normalizeSiteAllowlist(normalizedOverrides.siteAllowlist),
  };
}
