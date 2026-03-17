// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('stet', () => ({
  check: vi.fn(() => []),
  checkDocument: vi.fn((documentInput: { headline?: string; body: string[] }) => {
    const fullText = [documentInput.headline, ...documentInput.body].filter(Boolean).join('\n\n');
    const offset = fullText.indexOf('thmme');
    if (offset === -1) return [];

    return [
      {
        rule: 'COMMON-SPELL-01',
        severity: 'warning',
        offset,
        length: 5,
        originalText: 'thmme',
        suggestion: 'thyme',
        description: 'Misspelling',
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

function setGoogleDocsLocation() {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('https://docs.google.com/document/d/abc/edit'),
  });

  document.title = 'Quarterly update - Google Docs';
}

function mockRect(element: Element, left: number, top: number, width: number, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
  });
}

async function waitForChecks() {
  await new Promise((resolve) => setTimeout(resolve, 380));
}

function createFakeDocsInput(root: HTMLElement, mode: 'html' | 'svg' = 'html') {
  const iframe = document.querySelector('iframe.docs-texteventtarget-iframe') as HTMLIFrameElement;
  const iframeDoc = document.implementation.createHTMLDocument('');
  iframeDoc.body.innerHTML = '<div contenteditable="true"></div>';

  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    value: iframeDoc,
  });

  const state = {
    text: 'Alpha beta thmme gamma',
    selectionStart: 11,
    selectionEnd: 11,
  };

  const render = () => {
    if (mode === 'svg') {
      const fragments = state.text.split(' ');
      root.innerHTML = `
        <div class="kix-page-paginated">
          <svg class="kix-canvas-tile-content">
            ${fragments.map((_, index) => `<rect data-word-index="${index}"></rect>`).join('')}
          </svg>
        </div>
        <div class="kix-cursor"><div class="kix-cursor-caret"></div></div>
      `;

      const page = root.querySelector('.kix-page-paginated') as HTMLElement;
      const rects = root.querySelectorAll<SVGRectElement>('rect[data-word-index]');
      const caret = root.querySelector('.kix-cursor-caret') as HTMLElement;

      mockRect(root, 30, 30, 860, 1080);
      mockRect(page, 40, 40, 820, 1040);

      let left = 80;
      fragments.forEach((fragment, index) => {
        const rect = rects[index];
        rect.setAttribute('aria-label', fragment);
        const width = Math.max(24, fragment.length * 8);
        mockRect(rect, left, 120, width, 18);
        left += width + 6;
      });

      mockRect(caret, 80 + (state.selectionEnd * 8), 120, 1, 18);
      return;
    }

    root.innerHTML = `
      <div class="kix-page-paginated">
        <div class="kix-lineview">
          <div class="kix-lineview-text-block"></div>
          <span class="kix-wordhtmlgenerator-word-node"></span>
          <span class="kix-wordhtmlgenerator-word-node"></span>
          <span class="kix-wordhtmlgenerator-word-node"></span>
        </div>
      </div>
      <div class="kix-cursor"><div class="kix-cursor-caret"></div></div>
    `;

    const page = root.querySelector('.kix-page-paginated') as HTMLElement;
    const line = root.querySelector('.kix-lineview') as HTMLElement;
    const lineText = root.querySelector('.kix-lineview-text-block') as HTMLElement;
    const words = root.querySelectorAll<HTMLElement>('.kix-wordhtmlgenerator-word-node');
    const caret = root.querySelector('.kix-cursor-caret') as HTMLElement;

    const prefix = state.text.slice(0, 11);
    const middle = state.text.slice(11, 16);
    const suffix = state.text.slice(16);

    lineText.textContent = state.text;
    words[0].textContent = prefix;
    words[1].textContent = middle;
    words[2].textContent = suffix;

    mockRect(root, 30, 30, 860, 1080);
    mockRect(page, 40, 40, 820, 1040);
    mockRect(line, 80, 120, 300, 20);
    mockRect(lineText, 80, 120, 300, 20);
    mockRect(words[0], 80, 120, 96, 18);
    mockRect(words[1], 176, 120, 48, 18);
    mockRect(words[2], 224, 120, 72, 18);
    mockRect(caret, 80 + (state.selectionEnd * 8), 120, 1, 18);
  };

  const deleteSelection = () => {
    const start = Math.min(state.selectionStart, state.selectionEnd);
    const end = Math.max(state.selectionStart, state.selectionEnd);
    if (start === end) return false;
    state.text = `${state.text.slice(0, start)}${state.text.slice(end)}`;
    state.selectionStart = start;
    state.selectionEnd = start;
    return true;
  };

  const insertText = (text: string) => {
    deleteSelection();
    const caret = state.selectionEnd;
    state.text = `${state.text.slice(0, caret)}${text}${state.text.slice(caret)}`;
    state.selectionStart = caret + text.length;
    state.selectionEnd = caret + text.length;
  };

  iframeDoc.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      state.selectionStart = 0;
      state.selectionEnd = state.text.length;
      render();
      return;
    }

    if (event.key === 'ArrowLeft') {
      const next = Math.max(0, state.selectionEnd - 1);
      if (event.shiftKey) {
        state.selectionEnd = next;
      } else {
        state.selectionStart = next;
        state.selectionEnd = next;
      }
      render();
      return;
    }

    if (event.key === 'ArrowRight') {
      const next = Math.min(state.text.length, state.selectionEnd + 1);
      if (event.shiftKey) {
        state.selectionEnd = next;
      } else {
        state.selectionStart = next;
        state.selectionEnd = next;
      }
      render();
      return;
    }

    if (event.key === 'Backspace') {
      if (!deleteSelection() && state.selectionEnd > 0) {
        state.text = `${state.text.slice(0, state.selectionEnd - 1)}${state.text.slice(state.selectionEnd)}`;
        state.selectionStart -= 1;
        state.selectionEnd -= 1;
      }
      render();
      return;
    }

    if (event.key === 'Delete') {
      if (!deleteSelection() && state.selectionEnd < state.text.length) {
        state.text = `${state.text.slice(0, state.selectionEnd)}${state.text.slice(state.selectionEnd + 1)}`;
      }
      render();
      return;
    }
  });

  iframeDoc.addEventListener('keypress', (event) => {
    if (!event.key) return;
    insertText(event.key);
    render();
  });

  render();
  return Object.assign(state, {
    iframeDoc,
    setText(text: string, caret = text.length) {
      state.text = text;
      state.selectionStart = caret;
      state.selectionEnd = caret;
      render();
    },
  });
}

describe('checker google docs overlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
    setGoogleDocsLocation();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders overlay marks on the Google Docs surface instead of inline marks', async () => {
    createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <div id="docs-editor">
        <div id="docs-root" class="kix-appview-editor"></div>
      </div>
      <iframe class="docs-texteventtarget-iframe"></iframe>
    `;

    const root = document.getElementById('docs-root') as HTMLElement;
    createFakeDocsInput(root);

    await initChecker();
    await waitForChecks();

    expect(document.querySelectorAll('.stet-overlay-mark').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('stet-mark')).toHaveLength(0);

    const cardTrigger = document.querySelector('.stet-overlay-mark') as HTMLButtonElement | null;
    expect(cardTrigger).not.toBeNull();

    cardTrigger?.click();

    const card = document.querySelector('.stet-card');
    expect(card?.textContent).toContain('COMMON-SPELL-01');
    expect(card?.textContent).toContain('thmme');
    expect(card?.textContent).toContain('thyme');

    expect(document.querySelector('.stet-suggestion-chip')).not.toBeNull();
  });

  it('renders overlay marks when Docs only exposes aria-label SVG rects', async () => {
    createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <div id="docs-editor">
        <div id="docs-root" class="kix-appview-editor"></div>
      </div>
      <iframe class="docs-texteventtarget-iframe"></iframe>
    `;

    const root = document.getElementById('docs-root') as HTMLElement;
    createFakeDocsInput(root, 'svg');

    await initChecker();
    await waitForChecks();

    expect(document.querySelectorAll('.stet-overlay-mark').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('stet-mark')).toHaveLength(0);

    const cardTrigger = document.querySelector('.stet-overlay-mark') as HTMLButtonElement | null;
    expect(cardTrigger).not.toBeNull();

    cardTrigger?.click();

    const card = document.querySelector('.stet-card');
    expect(card?.textContent).toContain('COMMON-SPELL-01');
    expect(card?.textContent).toContain('thmme');
    expect(card?.textContent).toContain('thyme');
  });
});
