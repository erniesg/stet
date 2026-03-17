import { describe, expect, it } from 'vitest';
import { DEFAULT_RESOLVED_CONFIG } from 'stet';

import {
  applyProfileToConfig,
  detectProfileId,
  getActiveProfileId,
  getProfileLanguage,
  getProfile,
  isSupportedLanguage,
  listLanguageOptions,
  listProfiles,
  resolveLanguageSetting,
} from '../packages/extension/src/storage/profiles.js';

describe('extension profiles', () => {
  it('exposes the Singapore Chinese preset with zh-SG spellcheck defaults', () => {
    const singaporeChinese = getProfile('sg-chinese');

    expect(singaporeChinese.name).toBe('Singapore Chinese');
    expect(singaporeChinese.language).toBe('zh-SG');
    expect(singaporeChinese.enabledRules).toEqual(['COMMON-SPELL-01']);
    expect(singaporeChinese.suggestedHosts).toEqual([]);
  });

  it('applies the Singapore Chinese profile as a non-destructive overlay', () => {
    const config = applyProfileToConfig({
      ...DEFAULT_RESOLVED_CONFIG,
      packs: ['common', 'bt'],
      language: 'en-US',
      role: 'subeditor',
      packConfig: {
        ...DEFAULT_RESOLVED_CONFIG.packConfig,
        language: 'en-US',
      },
      rules: {
        enable: ['BT-STYLE-01'],
        disable: ['COMMON-FRE-01'],
      },
    }, 'sg-chinese');

    expect(config.packs).toEqual(['common', 'bt']);
    expect(config.language).toBe('zh-SG');
    expect(config.packConfig.language).toBe('zh-SG');
    expect(config.role).toBe('journalist');
    expect(config.rules.enable).toEqual(['COMMON-SPELL-01']);
    expect(config.rules.disable).toEqual([]);
  });

  it('keeps the legacy zaobao alias working for callers', () => {
    const aliased = getProfile('zaobao');

    expect(aliased.id).toBe('sg-chinese');
    expect(aliased.name).toBe('Singapore Chinese');
    expect(aliased.language).toBe('zh-SG');
  });

  it('detects legacy bundled profiles from stored resolved config', () => {
    expect(detectProfileId(DEFAULT_RESOLVED_CONFIG)).toBe('standard');
    expect(detectProfileId(applyProfileToConfig(DEFAULT_RESOLVED_CONFIG, 'sg-chinese'))).toBe('sg-chinese');
    expect(detectProfileId({
      ...applyProfileToConfig(DEFAULT_RESOLVED_CONFIG, 'sg-chinese'),
      role: 'subeditor',
    })).toBeNull();
  });

  it('derives the active profile from overrides before legacy config inference', () => {
    expect(getActiveProfileId('sg-chinese', DEFAULT_RESOLVED_CONFIG)).toBe('sg-chinese');
    expect(getActiveProfileId(undefined, DEFAULT_RESOLVED_CONFIG)).toBe('standard');
  });

  it('lists both bundled profiles', () => {
    expect(listProfiles().map(profile => profile.id)).toEqual(['standard', 'sg-chinese']);
  });

  it('lists supported demo language toggles', () => {
    expect(listLanguageOptions().map(option => option.id)).toEqual(['base', 'en-GB', 'en-US', 'zh-SG']);
    expect(listLanguageOptions()[0]?.label).toBe('Auto');
    expect(isSupportedLanguage('zh-SG')).toBe(true);
    expect(isSupportedLanguage('fr-FR')).toBe(false);
  });

  it('derives profile language and collapses redundant explicit overrides back to base', () => {
    expect(getProfileLanguage(DEFAULT_RESOLVED_CONFIG, 'standard')).toBe('en-GB');
    expect(getProfileLanguage(DEFAULT_RESOLVED_CONFIG, 'sg-chinese')).toBe('zh-SG');
    expect(resolveLanguageSetting(undefined, 'en-GB')).toBe('base');
    expect(resolveLanguageSetting('en-GB', 'en-GB')).toBe('base');
    expect(resolveLanguageSetting('en-US', 'en-GB')).toBe('en-US');
  });
});
