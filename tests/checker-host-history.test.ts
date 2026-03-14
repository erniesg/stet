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

function createChromeMock() {
  const storage = new Map<string, unknown>();
  const listeners: RuntimeListener[] = [];

  const sendMessage = vi.fn((message: Record<string, unknown>, callback?: (response: unknown) => void) => {
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
  });

  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    runtime: {
      sendMessage,
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

async function dispatchRuntimeMessage(listener: RuntimeListener, message: Record<string, unknown>) {
  return new Promise<unknown>((resolve) => {
    const handledAsync = listener(message, {}, resolve);
    if (handledAsync === false) {
      resolve(undefined);
    }
  });
}

describe('checker host-managed history reads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
    delete window.btEditor;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.btEditor;
    vi.restoreAllMocks();
  });

  it('serves popup history state and snapshots from the host adapter text', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');
    const { getEditableTarget } = await import('../packages/extension/src/content/editable-target.js');

    document.body.innerHTML = `
      <div id="bt-editor-content" contenteditable="true" aria-label="Body">
        <span class="fig-ref">Rendered DOM text</span>
      </div>
    `;

    const editor = document.getElementById('bt-editor-content') as HTMLElement;
    mockRect(editor);

    let plainText = 'Adapter text from BTEditor';
    window.btEditor = {
      contentEl: editor,
      getText: vi.fn(() => plainText),
      setText: vi.fn((text: string) => {
        plainText = text;
      }),
    };

    await initChecker();

    const target = getEditableTarget(editor);
    expect(target).not.toBeNull();
    expect(listeners).toHaveLength(1);

    const historyState = await dispatchRuntimeMessage(listeners[0], {
      type: 'GET_EDITOR_HISTORY_STATE',
      fieldKey: target!.fieldKey,
    }) as { ok: boolean; currentText: string };

    expect(historyState.ok).toBe(true);
    expect(historyState.currentText).toBe('Adapter text from BTEditor');

    const snapshotState = await dispatchRuntimeMessage(listeners[0], {
      type: 'CAPTURE_EDITOR_SNAPSHOT',
      fieldKey: target!.fieldKey,
    }) as { ok: boolean; currentText: string };

    expect(snapshotState.ok).toBe(true);
    expect(snapshotState.currentText).toBe('Adapter text from BTEditor');
  });
});
