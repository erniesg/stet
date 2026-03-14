// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('stet', () => ({
  check: vi.fn(() => []),
  checkDocument: vi.fn(() => [
    {
      rule: 'SPELL',
      severity: 'warning',
      offset: 0,
      length: 3,
      originalText: 'teh',
      suggestion: 'the',
      description: 'Spelling issue',
      canFix: true,
    },
  ]),
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
  await new Promise((resolve) => setTimeout(resolve, 120));
}

describe('checker safe mode ui', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the outside-editor issue panel for textarea surfaces', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `<textarea id="draft" aria-label="Draft body"></textarea>`;

    const textarea = document.getElementById('draft') as HTMLTextAreaElement;
    mockRect(textarea);

    await initChecker();

    textarea.value = 'teh draft';
    textarea.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    const button = document.querySelector('.stet-issues-button') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.hidden).toBe(false);
    expect(button.textContent).toContain('1 issue');

    button.click();

    const panel = document.querySelector('.stet-issues-panel') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('SPELL');
    expect(panel.textContent).toContain('teh -> the');

    const popupState = await dispatchRuntimeMessage(listeners[0], {
      type: 'GET_PAGE_ISSUES',
    }) as {
      editorCount: number;
      activeLabel: string | null;
      activeFieldKey: string | null;
      issues: Array<{ rule: string }>;
    };

    expect(popupState.editorCount).toBe(1);
    expect(popupState.activeLabel).toBe('Draft body');
    expect(popupState.activeFieldKey).toBeTruthy();
    expect(popupState.issues).toHaveLength(1);
    expect(popupState.issues[0]?.rule).toBe('SPELL');
  });
});
