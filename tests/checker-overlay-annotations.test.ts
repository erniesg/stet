// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('stet', () => ({
  check: vi.fn(() => []),
  checkDocument: vi.fn(() => [
    {
      rule: 'BT-DICT-01',
      severity: 'warning',
      offset: 6,
      length: 5,
      originalText: 'while',
      suggestion: 'whilst',
      description: 'Use the CPI house style term.',
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

async function waitForChecks() {
  await new Promise((resolve) => setTimeout(resolve, 140));
}

describe('checker overlay annotations', () => {
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

    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => ([
        {
          width: 58,
          height: 18,
          top: 32,
          left: 96,
          right: 154,
          bottom: 50,
          x: 96,
          y: 32,
          toJSON: () => ({}),
        },
      ] as unknown as DOMRectList),
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.btEditor;
    delete (HTMLElement.prototype as { isContentEditable?: boolean }).isContentEditable;
    vi.restoreAllMocks();
  });

  it('renders clickable overlay marks for BTEditor-style host surfaces', async () => {
    createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <div id="bt-editor-content" class="ProseMirror" contenteditable="true" aria-label="Body">
        <p>Alpha <span class="fig-ref">while</span> beta</p>
      </div>
    `;

    const editor = document.getElementById('bt-editor-content') as HTMLElement;
    mockRect(editor);

    let plainText = 'Alpha while beta';
    window.btEditor = {
      contentEl: editor,
      getText: vi.fn(() => plainText),
      setText: vi.fn((text: string) => {
        plainText = text;
      }),
    };

    await initChecker();

    editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    const overlayMarks = document.querySelectorAll('.stet-overlay-mark');
    expect(overlayMarks.length).toBeGreaterThan(0);
    expect(document.querySelectorAll('stet-mark')).toHaveLength(0);

    (overlayMarks[0] as HTMLButtonElement).click();

    const card = document.querySelector('.stet-card') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('BT-DICT-01');
    expect(card?.textContent).toContain('while');
    expect(card?.textContent).toContain('whilst');
  });
});
