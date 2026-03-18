import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadCustomTerms,
  loadDictionary,
  normalizeCustomTerms,
  saveCustomTerms,
} from '../packages/extension/src/content/dictionary-loader.js';

interface ChromeStorageAreaStub {
  get: (keys: unknown, callback: (result: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
}

function installChromeStub() {
  const syncStorage = new Map<string, unknown>();
  const localStorage = new Map<string, unknown>();

  const makeArea = (storage: Map<string, unknown>): ChromeStorageAreaStub => ({
    get: (keys, callback) => {
      if (typeof keys === 'string') {
        callback({ [keys]: storage.get(keys) });
        return;
      }

      const defaults = (keys ?? {}) as Record<string, unknown>;
      const result: Record<string, unknown> = { ...defaults };
      for (const [key, value] of storage.entries()) {
        result[key] = value;
      }
      callback(result);
    },
    set: (items, callback) => {
      for (const [key, value] of Object.entries(items)) {
        storage.set(key, value);
      }
      callback?.();
    },
  });

  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      sync: makeArea(syncStorage),
      local: makeArea(localStorage),
    },
  };

  return { syncStorage, localStorage };
}

describe('dictionary loader', () => {
  beforeEach(() => {
    installChromeStub();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '巴士\n转换\n站\n',
    })) as typeof fetch;
  });

  it('loads the zh-SG bundled dictionary asset when requested', async () => {
    await loadDictionary('zh-SG');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('wordlist-zh-sg.txt'),
    );
  });

  it('normalizes custom terms before persisting and loading them', async () => {
    await saveCustomTerms([' 德士 ', '', '德士', '巴士转换站']);

    expect(normalizeCustomTerms([' 德士 ', '', '德士', '巴士转换站'])).toEqual([
      '德士',
      '巴士转换站',
    ]);
    await expect(loadCustomTerms()).resolves.toEqual(['德士', '巴士转换站']);
  });
});
