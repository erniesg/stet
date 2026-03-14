// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('stet', () => ({
  check: vi.fn(() => []),
  checkDocument: vi.fn((documentInput: { headline?: string; body: string[] }) => {
    const fullText = [documentInput.headline, ...documentInput.body].filter(Boolean).join('\n\n');
    const offset = fullText.indexOf('teh');
    if (offset === -1) return [];

    return [
      {
        rule: 'SPELL',
        severity: 'warning',
        offset,
        length: 3,
        originalText: 'teh',
        suggestion: 'the',
        description: 'Spelling issue',
        canFix: true,
      },
    ];
  }),
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

async function waitForChecks() {
  await new Promise((resolve) => setTimeout(resolve, 140));
}

describe('checker live sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';

    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
      configurable: true,
      get() {
        const attribute = this.getAttribute?.('contenteditable');
        return attribute === '' || attribute === 'true' || attribute === 'plaintext-only';
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as { isContentEditable?: boolean }).isContentEditable;
    vi.restoreAllMocks();
  });

  it('clears stale issue UI immediately when the user edits the text', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `<div id="editor" contenteditable="true" aria-label="Draft body"></div>`;
    const editor = document.getElementById('editor') as HTMLElement;
    mockRect(editor);

    await initChecker();

    editor.textContent = 'teh draft';
    editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    expect(document.querySelectorAll('stet-mark')).toHaveLength(1);
    const initialState = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      issues: Array<{ rule: string }>;
    };
    expect(initialState.totalIssues).toBe(1);
    expect(initialState.issues[0]?.rule).toBe('SPELL');

    editor.textContent = 'the draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    const liveState = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      issues: Array<unknown>;
    };
    expect(document.querySelectorAll('stet-mark')).toHaveLength(0);
    expect(liveState.totalIssues).toBe(0);
    expect(liveState.issues).toHaveLength(0);

    await waitForChecks();

    const settledState = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      issues: Array<unknown>;
    };
    expect(settledState.totalIssues).toBe(0);
    expect(settledState.issues).toHaveLength(0);
  });
});
