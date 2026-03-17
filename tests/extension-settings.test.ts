import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RESOLVED_CONFIG } from 'stet';
import { getEffectiveConfig, loadSettings } from '../packages/extension/src/storage/settings.js';

function installChromeStorageSync(seed: Record<string, unknown>) {
  const storage = new Map<string, unknown>(Object.entries(seed));

  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    storage: {
      sync: {
        get: (defaults: Record<string, unknown>, callback: (result: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = { ...defaults };
          for (const [key, value] of storage.entries()) {
            result[key] = value;
          }
          callback(result);
        },
        set: (items: Record<string, unknown>, callback?: () => void) => {
          for (const [key, value] of Object.entries(items)) {
            storage.set(key, value);
          }
          callback?.();
        },
      },
    },
  };

  return storage;
}

describe('extension settings normalization', () => {
  beforeEach(() => {
    installChromeStorageSync({});
  });

  it('defaults user overrides to an empty allowlist so the extension can run everywhere', async () => {
    installChromeStorageSync({
      resolvedConfig: {
        ...DEFAULT_RESOLVED_CONFIG,
        siteAllowlist: ['mail.google.com'],
      },
      userOverrides: {
        role: 'editor',
      },
    });

    const settings = await loadSettings();
    expect(settings.userOverrides.siteAllowlist).toEqual([]);

    const effective = await getEffectiveConfig();
    expect(effective.siteAllowlist).toEqual([]);
  });

  it('preserves an explicit user site allowlist', async () => {
    installChromeStorageSync({
      resolvedConfig: {
        ...DEFAULT_RESOLVED_CONFIG,
        siteAllowlist: ['mail.google.com'],
      },
      userOverrides: {
        siteAllowlist: ['mail.google.com'],
      },
    });

    const settings = await loadSettings();
    expect(settings.userOverrides.siteAllowlist).toEqual(['mail.google.com']);

    const effective = await getEffectiveConfig();
    expect(effective.siteAllowlist).toEqual(['mail.google.com']);
  });

  it('applies the selected demo profile without replacing the loaded newsroom config', async () => {
    installChromeStorageSync({
      resolvedConfig: {
        ...DEFAULT_RESOLVED_CONFIG,
        packs: ['common', 'bt'],
        language: 'en-US',
        role: 'subeditor',
        packConfig: {
          ...DEFAULT_RESOLVED_CONFIG.packConfig,
          language: 'en-US',
        },
      },
      userOverrides: {
        profileId: 'sg-chinese',
      },
    });

    const effective = await getEffectiveConfig();
    expect(effective.packs).toEqual(['common', 'bt']);
    expect(effective.language).toBe('zh-SG');
    expect(effective.packConfig.language).toBe('zh-SG');
    expect(effective.rules.enable).toEqual(['COMMON-SPELL-01']);
  });

  it('lets an explicit language override win over the selected demo profile', async () => {
    installChromeStorageSync({
      resolvedConfig: DEFAULT_RESOLVED_CONFIG,
      userOverrides: {
        profileId: 'sg-chinese',
        language: 'en-US',
      },
    });

    const effective = await getEffectiveConfig();
    expect(effective.language).toBe('en-US');
    expect(effective.packConfig.language).toBe('en-US');
    expect(effective.rules.enable).toEqual(['COMMON-SPELL-01']);
  });
});
