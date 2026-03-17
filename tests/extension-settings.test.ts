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

  it('migrates legacy profileId sg-chinese to zh-SG language', async () => {
    installChromeStorageSync({
      resolvedConfig: DEFAULT_RESOLVED_CONFIG,
      userOverrides: {
        profileId: 'sg-chinese',
      },
    });

    const settings = await loadSettings();
    // profileId should be stripped
    expect(settings.userOverrides.profileId).toBeUndefined();
    // language should be migrated
    expect(settings.userOverrides.language).toBe('zh-SG');

    const effective = await getEffectiveConfig();
    expect(effective.language).toBe('zh-SG');
    expect(effective.packConfig.language).toBe('zh-SG');
  });

  it('migrates legacy zaobao alias to zh-SG language', async () => {
    installChromeStorageSync({
      resolvedConfig: DEFAULT_RESOLVED_CONFIG,
      userOverrides: {
        profileId: 'zaobao',
      },
    });

    const settings = await loadSettings();
    expect(settings.userOverrides.profileId).toBeUndefined();
    expect(settings.userOverrides.language).toBe('zh-SG');
  });

  it('preserves explicit language even when profileId is present', async () => {
    installChromeStorageSync({
      resolvedConfig: DEFAULT_RESOLVED_CONFIG,
      userOverrides: {
        profileId: 'sg-chinese',
        language: 'en-US',
      },
    });

    const settings = await loadSettings();
    expect(settings.userOverrides.language).toBe('en-US');
  });

  it('normalizes packs by stripping empty entries', async () => {
    installChromeStorageSync({
      resolvedConfig: DEFAULT_RESOLVED_CONFIG,
      userOverrides: {
        packs: ['common', '', 'bt', '  '],
      },
    });

    const settings = await loadSettings();
    expect(settings.userOverrides.packs).toEqual(['common', 'bt']);
  });

  it('omits packs override when empty after normalization', async () => {
    installChromeStorageSync({
      resolvedConfig: DEFAULT_RESOLVED_CONFIG,
      userOverrides: {
        packs: ['', '  '],
      },
    });

    const settings = await loadSettings();
    expect(settings.userOverrides.packs).toBeUndefined();
  });

  it('applies user-selected packs via effective config', async () => {
    installChromeStorageSync({
      resolvedConfig: {
        ...DEFAULT_RESOLVED_CONFIG,
        packs: ['common', 'bt', 'tia'],
      },
      userOverrides: {
        packs: ['common', 'bt'],
      },
    });

    const effective = await getEffectiveConfig();
    expect(effective.packs).toEqual(['common', 'bt']);
  });
});
