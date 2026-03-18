import { DEFAULT_RESOLVED_CONFIG } from 'stet';
import type { Language, ResolvedStetConfig } from 'stet';

export interface ExtensionProfile {
  id: string;
  name: string;
  description: string;
  suggestedHosts: string[];
  language?: Language;
  role?: string;
  enabledRules?: string[];
  disabledRules?: string[];
}

export interface LanguageOption {
  id: 'base' | Language;
  label: string;
  description: string;
}

const STANDARD_PROFILE: ExtensionProfile = {
  id: 'standard',
  name: 'Base Newsroom',
  description: 'Keeps the currently loaded newsroom or product config intact.',
  suggestedHosts: [],
};

const SG_CHINESE_PROFILE: ExtensionProfile = {
  id: 'sg-chinese',
  name: 'Singapore Chinese',
  description: 'Keeps the current newsroom config but forces zh-SG spellcheck-only mode for demo and review flows.',
  suggestedHosts: [],
  language: 'zh-SG',
  role: 'journalist',
  enabledRules: ['COMMON-SPELL-01'],
  disabledRules: [],
};

const PROFILES = [STANDARD_PROFILE, SG_CHINESE_PROFILE];
const PROFILE_ALIASES: Record<string, string> = {
  zaobao: SG_CHINESE_PROFILE.id,
};
const SUPPORTED_LANGUAGES = ['en-GB', 'en-US', 'zh-SG'] as const;
const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: 'base', label: 'Auto', description: 'Follow the selected profile language.' },
  { id: 'en-GB', label: 'en-GB', description: 'British English.' },
  { id: 'en-US', label: 'en-US', description: 'American English.' },
  { id: 'zh-SG', label: 'zh-SG', description: 'Singapore Chinese.' },
];

export function listProfiles(): ExtensionProfile[] {
  return PROFILES.map(cloneProfile);
}

export function getProfile(profileId: string): ExtensionProfile {
  const resolvedProfileId = normalizeProfileId(profileId);
  const profile = PROFILES.find(candidate => candidate.id === resolvedProfileId) ?? STANDARD_PROFILE;
  return cloneProfile(profile);
}

export function listLanguageOptions(): LanguageOption[] {
  return LANGUAGE_OPTIONS.map(option => ({ ...option }));
}

export function isSupportedLanguage(language: unknown): language is Language {
  return typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language as Language);
}

export function normalizeProfileId(profileId?: string | null): string | null {
  if (typeof profileId !== 'string' || profileId.trim().length === 0) return null;
  const resolvedProfileId = PROFILE_ALIASES[profileId] ?? profileId;
  return PROFILES.some(candidate => candidate.id === resolvedProfileId) ? resolvedProfileId : null;
}

export function getActiveProfileId(
  profileId?: string | null,
  config?: Partial<ResolvedStetConfig> | null,
): string {
  return normalizeProfileId(profileId) ?? detectProfileId(config) ?? STANDARD_PROFILE.id;
}

export function applyProfileToConfig(
  baseConfig: ResolvedStetConfig,
  profileId?: string | null,
): ResolvedStetConfig {
  const profile = getProfile(profileId ?? STANDARD_PROFILE.id);
  const config = cloneResolvedConfig(baseConfig);

  if (profile.language) {
    config.language = profile.language;
    config.packConfig.language = profile.language;
  }
  if (profile.role) {
    config.role = profile.role;
  }
  if (profile.enabledRules) {
    config.rules.enable = [...profile.enabledRules];
  }
  if (profile.disabledRules) {
    config.rules.disable = [...profile.disabledRules];
  }

  return config;
}

export function getProfileLanguage(
  resolvedConfig?: ResolvedStetConfig | null,
  profileId?: string | null,
): Language {
  return applyProfileToConfig(
    resolvedConfig ? cloneResolvedConfig(resolvedConfig) : cloneResolvedConfig(DEFAULT_RESOLVED_CONFIG),
    profileId,
  ).language;
}

export function resolveLanguageSetting(
  explicitLanguage: Language | null | undefined,
  profileLanguage: Language,
): LanguageOption['id'] {
  return explicitLanguage && explicitLanguage !== profileLanguage ? explicitLanguage : 'base';
}

export function detectProfileId(config?: Partial<ResolvedStetConfig> | null): string | null {
  if (!config) return null;

  const normalized = normalizeResolvedConfig(config);
  for (const profile of PROFILES) {
    if (JSON.stringify(normalized) === JSON.stringify(normalizeResolvedConfig(getLegacyProfileConfig(profile.id)))) {
      return profile.id;
    }
  }

  return null;
}

function getLegacyProfileConfig(profileId: string): ResolvedStetConfig {
  if (profileId === SG_CHINESE_PROFILE.id) {
    return {
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
    };
  }

  return cloneResolvedConfig(DEFAULT_RESOLVED_CONFIG);
}

function cloneProfile(profile: ExtensionProfile): ExtensionProfile {
  return {
    ...profile,
    suggestedHosts: [...profile.suggestedHosts],
    enabledRules: profile.enabledRules ? [...profile.enabledRules] : undefined,
    disabledRules: profile.disabledRules ? [...profile.disabledRules] : undefined,
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
