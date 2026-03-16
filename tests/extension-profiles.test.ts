import { describe, expect, it } from 'vitest';

import {
  detectProfileId,
  getProfile,
  listProfiles,
  resetOverridesForProfile,
} from '../packages/extension/src/storage/profiles.js';

describe('extension profiles', () => {
  it('exposes the Zaobao preset with zh-SG spellcheck only', () => {
    const zaobao = getProfile('zaobao');

    expect(zaobao.name).toBe('Zaobao Chinese');
    expect(zaobao.resolvedConfig.language).toBe('zh-SG');
    expect(zaobao.resolvedConfig.rules.enable).toEqual(['COMMON-SPELL-01']);
    expect(zaobao.suggestedHosts).toContain('www.zaobao.com.sg');
  });

  it('detects built-in profiles from resolved config', () => {
    const standard = getProfile('standard');
    const zaobao = getProfile('zaobao');

    expect(detectProfileId(standard.resolvedConfig)).toBe('standard');
    expect(detectProfileId(zaobao.resolvedConfig)).toBe('zaobao');
    expect(detectProfileId({
      ...zaobao.resolvedConfig,
      role: 'subeditor',
    })).toBeNull();
  });

  it('drops profile-specific user overrides while preserving site scope and enabled state', () => {
    expect(resetOverridesForProfile({
      enabled: false,
      role: 'subeditor',
      disableRules: ['COMMON-SPACE-01'],
      siteAllowlist: ['www.zaobao.com.sg'],
      debounceMs: 250,
    })).toEqual({
      enabled: false,
      siteAllowlist: ['www.zaobao.com.sg'],
      debounceMs: 250,
    });
  });

  it('lists both bundled profiles', () => {
    expect(listProfiles().map(profile => profile.id)).toEqual(['standard', 'zaobao']);
  });
});
