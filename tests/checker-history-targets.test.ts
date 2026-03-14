// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HISTORY_POLICY } from '../packages/extension/src/content/version-history-core.js';
import { getEditableTarget } from '../packages/extension/src/content/editable-target.js';
import { saveSnapshotForTarget } from '../packages/extension/src/content/version-history-store.js';

vi.mock('stet', () => ({
  check: vi.fn(() => []),
  checkDocument: vi.fn(() => []),
  toCheckOptions: vi.fn(() => ({})),
  listPacks: vi.fn(() => [{ id: 'common', rules: [] }]),
}));

vi.mock('../packages/extension/src/content/dictionary-loader.js', () => ({
  loadDictionary: vi.fn(async () => []),
  loadCustomTerms: vi.fn(async () => []),
}));

interface RuntimeListener {
  (
    message: Record<string, unknown>,
    sender: unknown,
    sendResponse: (response: unknown) => void,
  ): boolean | void;
}

function createChromeMock() {
  const listeners: RuntimeListener[] = [];
  const storage = new Map<string, unknown>();

  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
        if (message?.type === 'GET_SETTINGS') {
          callback?.({
            config: {
              packs: ['common'],
              language: 'en-GB',
              role: 'journalist',
              packConfig: { freThreshold: 30, paragraphCharLimit: 320 },
              rules: { enable: [], disable: [] },
              dictionaries: [],
              prompts: {},
              workflows: {},
              feedback: { endpoint: null, batchSize: 20, includeContext: false },
              enabled: true,
              siteAllowlist: [],
              debounceMs: 25,
            },
          });
          return;
        }

        callback?.({});
      }),
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          listeners.push(listener);
        }),
      },
    },
    storage: {
      local: {
        get: (key: string | string[], callback: (result: Record<string, unknown>) => void) => {
          if (Array.isArray(key)) {
            callback(Object.fromEntries(key.map((entry) => [entry, storage.get(entry)])));
            return;
          }

          callback({ [key]: storage.get(key) });
        },
        set: (items: Record<string, unknown>, callback?: () => void) => {
          Object.entries(items).forEach(([key, value]) => {
            storage.set(key, value);
          });
          callback?.();
        },
        remove: (keys: string[], callback?: () => void) => {
          keys.forEach((key) => {
            storage.delete(key);
          });
          callback?.();
        },
      },
    },
  };

  return { listeners };
}

function mockRect(element: HTMLElement, width = 320, height = 120) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

async function dispatchRuntimeMessage(listener: RuntimeListener, message: Record<string, unknown>) {
  return new Promise<unknown>((resolve) => {
    const handledAsync = listener(message, {}, resolve);
    if (handledAsync === false) {
      resolve(undefined);
    }
  });
}

describe('checker page history targets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('lists multiple live history targets with saved version counts', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <textarea id="headline" aria-label="Headline"></textarea>
      <textarea id="body" aria-label="Body"></textarea>
    `;

    const headline = document.getElementById('headline') as HTMLTextAreaElement;
    const body = document.getElementById('body') as HTMLTextAreaElement;
    mockRect(headline, 320, 40);
    mockRect(body, 320, 120);

    await initChecker();

    const headlineTarget = getEditableTarget(headline);
    const bodyTarget = getEditableTarget(body);
    expect(headlineTarget).not.toBeNull();
    expect(bodyTarget).not.toBeNull();

    await saveSnapshotForTarget(headlineTarget!, 'Headline v1', 'manual', DEFAULT_HISTORY_POLICY, true);
    await saveSnapshotForTarget(bodyTarget!, 'Body v1', 'manual', DEFAULT_HISTORY_POLICY, true);
    await saveSnapshotForTarget(bodyTarget!, 'Body v2', 'manual', DEFAULT_HISTORY_POLICY, true);

    body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const state = await dispatchRuntimeMessage(listeners[0], {
      type: 'GET_PAGE_HISTORY_TARGETS',
    }) as {
      activeFieldKey: string | null;
      targets: Array<{
        fieldKey: string;
        label: string;
        snapshotCount: number;
        isActive: boolean;
      }>;
    };

    expect(state.activeFieldKey).toBe(bodyTarget!.fieldKey);
    expect(state.targets).toHaveLength(2);
    expect(state.targets[0]).toMatchObject({
      fieldKey: bodyTarget!.fieldKey,
      label: 'Body',
      snapshotCount: 2,
      isActive: true,
    });
    expect(state.targets[1]).toMatchObject({
      fieldKey: headlineTarget!.fieldKey,
      label: 'Headline',
      snapshotCount: 1,
      isActive: false,
    });
  });
});
