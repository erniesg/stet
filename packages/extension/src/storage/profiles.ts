import { DEFAULT_RESOLVED_CONFIG } from 'stet';
import type { ResolvedStetConfig, UserOverrides } from 'stet';

export interface ExtensionProfile {
  id: string;
  name: string;
  description: string;
  suggestedHosts: string[];
  resolvedConfig: ResolvedStetConfig;
}

const ZAOBAO_SUGGESTED_HOSTS = ['www.zaobao.com.sg', 'zaobao.com.sg'];

const STANDARD_PROFILE: ExtensionProfile = {
  id: 'standard',
  name: 'Standard English',
  description: 'Default Stet configuration for English copy.',
  suggestedHosts: [],
  resolvedConfig: DEFAULT_RESOLVED_CONFIG,
};

const ZAOBAO_PROFILE: ExtensionProfile = {
  id: 'zaobao',
  name: 'Zaobao Chinese',
  description: 'zh-SG spellcheck with the common pack limited to Chinese spelling checks.',
  suggestedHosts: ZAOBAO_SUGGESTED_HOSTS,
  resolvedConfig: {
    ...DEFAULT_RESOLVED_CONFIG,
    language: 'zh-SG',
    role: 'journalist',
    packConfig: {
      ...DEFAULT_RESOLVED_CONFIG.packConfig,
      language: 'zh-SG',
    },
    rules: {
      enable: ['COMMON-SPELL-01'],
      disable: [],
    },
  },
};

const PROFILES = [STANDARD_PROFILE, ZAOBAO_PROFILE];

export function listProfiles(): ExtensionProfile[] {
  return PROFILES.map(profile => ({
    ...profile,
    suggestedHosts: [...profile.suggestedHosts],
    resolvedConfig: cloneResolvedConfig(profile.resolvedConfig),
  }));
}

export function getProfile(profileId: string): ExtensionProfile {
  const profile = PROFILES.find(candidate => candidate.id === profileId) ?? STANDARD_PROFILE;
  return {
    ...profile,
    suggestedHosts: [...profile.suggestedHosts],
    resolvedConfig: cloneResolvedConfig(profile.resolvedConfig),
  };
}

export function detectProfileId(config?: Partial<ResolvedStetConfig> | null): string | null {
  if (!config) return null;

  const normalized = normalizeResolvedConfig(config);
  for (const profile of PROFILES) {
    if (JSON.stringify(normalized) === JSON.stringify(normalizeResolvedConfig(profile.resolvedConfig))) {
      return profile.id;
    }
  }

  return null;
}

export function resetOverridesForProfile(overrides?: Partial<UserOverrides> | null): UserOverrides {
  return {
    enabled: overrides?.enabled,
    debounceMs: overrides?.debounceMs,
    siteAllowlist: Array.isArray(overrides?.siteAllowlist) ? [...overrides.siteAllowlist] : [],
  };
}

function cloneResolvedConfig(config: ResolvedStetConfig): ResolvedStetConfig {
  return {
    ...config,
    packs: [...config.packs],
    packConfig: { ...config.packConfig },
    rules: {
      enable: [...config.rules.enable],
      disable: [...config.rules.disable],
    },
    dictionaries: [...config.dictionaries],
    prompts: { ...config.prompts },
    workflows: { ...config.workflows },
    feedback: { ...config.feedback },
    siteAllowlist: [...config.siteAllowlist],
  };
}

function normalizeResolvedConfig(config: Partial<ResolvedStetConfig>) {
  return {
    packs: [...(config.packs ?? [])],
    language: config.language ?? 'en-GB',
    role: config.role ?? 'journalist',
    packConfig: {
      ...config.packConfig,
    },
    rules: {
      enable: [...(config.rules?.enable ?? [])].sort(),
      disable: [...(config.rules?.disable ?? [])].sort(),
    },
    enabled: config.enabled ?? true,
    debounceMs: config.debounceMs ?? 500,
  };
}
