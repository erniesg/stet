// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

        if (message?.type === 'GET_HISTORY_SETTINGS') {
          callback?.({
            history: {
              enabled: true,
              uiMode: 'field',
              debug: false,
              experimentalHosts: [],
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
  };

  return { listeners };
}

async function dispatchRuntimeMessage(listener: RuntimeListener, message: Record<string, unknown>) {
  return new Promise<unknown>((resolve) => {
    const handledAsync = listener(message, {}, resolve);
    if (handledAsync === false) {
      resolve(undefined);
    }
  });
}

describe('checker history disabled', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
    window.__stetDisableHistory = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__stetDisableHistory;
    vi.restoreAllMocks();
  });

  it('returns no history targets or snapshots when history is disabled', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `<div id="editor" contenteditable="true" aria-label="Draft body"></div>`;

    await initChecker();

    const historyTargets = await dispatchRuntimeMessage(listeners[0], {
      type: 'GET_PAGE_HISTORY_TARGETS',
    }) as {
      activeFieldKey: string | null;
      targets: Array<unknown>;
    };

    expect(historyTargets.activeFieldKey).toBeNull();
    expect(historyTargets.targets).toHaveLength(0);

    const historyState = await dispatchRuntimeMessage(listeners[0], {
      type: 'GET_EDITOR_HISTORY_STATE',
      fieldKey: 'field-1',
    }) as {
      ok: boolean;
      liveEditorAvailable: boolean;
      currentText: string;
      record: unknown;
    };

    expect(historyState.ok).toBe(false);
    expect(historyState.liveEditorAvailable).toBe(false);
    expect(historyState.currentText).toBe('');
    expect(historyState.record).toBeNull();
  });
});
