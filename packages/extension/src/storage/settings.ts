/**
 * Extension settings — consumes ResolvedStetConfig from the core engine.
 *
 * The extension stores two things in chrome.storage:
 *   1. A resolved newsroom config (from stet.config.yaml, pre-resolved at build time)
 *   2. Per-user overrides (language, role, packs, disabled rules, site allowlist)
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
import { normalizeSiteAllowlist } from '../host-access.js';

// Re-export types for extension consumers
export type { ResolvedStetConfig };

const SUPPORTED_LANGUAGES: readonly string[] = ['en-GB', 'en-US', 'zh-SG'];

function isSupportedLanguage(language: unknown): language is Language {
  return typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language);
}

export interface UserOverrides extends CoreUserOverrides {
  language?: Language;
  packs?: string[];
  /** @deprecated Migrated to language — kept only so normalizeUserOverrides can read and strip it */
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
    siteAllowlist: [],
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
  return applyUserOverrides(resolvedConfig, userOverrides);
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

/**
 * Normalize user overrides — validates language, migrates legacy profileId,
 * normalizes packs and site allowlist.
 */
function normalizeUserOverrides(overrides?: Partial<UserOverrides> | null): UserOverrides {
  const raw = overrides ? { ...overrides } : {};

  // Migrate legacy profileId → language
  if (raw.profileId && !raw.language) {
    if (raw.profileId === 'sg-chinese' || raw.profileId === 'zaobao') {
      raw.language = 'zh-SG';
    }
  }
  delete raw.profileId;

  const language = isSupportedLanguage(raw.language)
    ? raw.language
    : undefined;

  // Normalize packs: strip empty/whitespace entries
  const packs = Array.isArray(raw.packs)
    ? raw.packs.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : undefined;

  // For user overrides, absent siteAllowlist means "run everywhere" (empty array).
  // Only normalize through the host-access layer when the user has explicitly set hosts.
  const siteAllowlist = Array.isArray(raw.siteAllowlist) && raw.siteAllowlist.length > 0
    ? normalizeSiteAllowlist(raw.siteAllowlist)
    : [];

  return {
    ...raw,
    language,
    packs: packs && packs.length > 0 ? packs : undefined,
    siteAllowlist,
  };
}
