// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

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

interface StorageChangeListener {
  (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
  ): void;
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

function createChromeMock(configOverrides: Partial<Record<string, unknown>> = {}) {
  const listeners: RuntimeListener[] = [];
  const storageChangeListeners: StorageChangeListener[] = [];

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
              ...configOverrides,
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
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          storageChangeListeners.push(listener);
        }),
      },
    },
  };

  return { listeners, storageChangeListeners };
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

  it('keeps common spellcheck enabled for zh-SG even when bt is registered', async () => {
    const stet = await import('stet');
    (stet.listPacks as Mock).mockReturnValue([
      { id: 'common', rules: [] },
      { id: 'bt', rules: [] },
    ]);

    createChromeMock({
      packs: ['common'],
      language: 'zh-SG',
      packConfig: { language: 'zh-SG', freThreshold: 30, paragraphCharLimit: 320 },
      rules: { enable: ['COMMON-SPELL-01'], disable: [] },
    });

    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `<div id="editor" contenteditable="true" aria-label="Draft body"></div>`;
    const editor = document.getElementById('editor') as HTMLElement;
    mockRect(editor);

    await initChecker();

    editor.textContent = '我在巴士转换站等巴士';
    editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    const configArg = (stet.toCheckOptions as Mock).mock.calls.at(-1)?.[0] as {
      language: string;
      rules: { disable: string[] };
    };

    expect(configArg.language).toBe('zh-SG');
    expect(configArg.rules.disable).not.toContain('COMMON-SPELL-01');
  });

  it('drops stale page issues when the issue-bearing editor is hidden and another editor stays active', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <div id="issue-editor" contenteditable="true" aria-label="Draft body"></div>
      <div id="clean-editor" contenteditable="true" aria-label="Additional instructions"></div>
    `;

    const issueEditor = document.getElementById('issue-editor') as HTMLElement;
    const cleanEditor = document.getElementById('clean-editor') as HTMLElement;
    mockRect(issueEditor);
    mockRect(cleanEditor);

    await initChecker();

    issueEditor.textContent = 'teh draft';
    issueEditor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    issueEditor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    cleanEditor.textContent = 'clean draft';
    cleanEditor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    cleanEditor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    let state = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      activeLabel: string | null;
      issues: Array<unknown>;
    };

    expect(state.totalIssues).toBe(1);
    expect(state.activeLabel).toBe('Additional instructions');
    expect(state.issues).toHaveLength(0);

    issueEditor.style.display = 'none';
    await new Promise((resolve) => setTimeout(resolve, 40));

    state = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      editorCount: number;
      activeLabel: string | null;
      issues: Array<unknown>;
    };

    expect(state.totalIssues).toBe(0);
    expect(state.editorCount).toBe(1);
    expect(state.activeLabel).toBe('Additional instructions');
    expect(state.issues).toHaveLength(0);
  });

  it('discovers and checks editors that become visible later', async () => {
    const { listeners } = createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <div
        id="revealed-editor"
        contenteditable="true"
        aria-label="Generated draft"
        style="display: none;"
      >teh draft</div>
    `;

    const editor = document.getElementById('revealed-editor') as HTMLElement;
    mockRect(editor);

    await initChecker();

    let state = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      editorCount: number;
      issues: Array<unknown>;
    };

    expect(state.totalIssues).toBe(0);
    expect(state.editorCount).toBe(0);
    expect(state.issues).toHaveLength(0);

    editor.style.display = 'block';
    editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    state = await dispatchRuntimeMessage(listeners[0], { type: 'GET_PAGE_ISSUES' }) as {
      totalIssues: number;
      editorCount: number;
      activeLabel: string | null;
      issues: Array<{ rule: string }>;
    };

    expect(state.totalIssues).toBe(1);
    expect(state.editorCount).toBe(1);
    expect(state.activeLabel).toBe('Generated draft');
    expect(state.issues[0]?.rule).toBe('SPELL');
  });

  it('reloads custom spellcheck terms from storage changes without a page reload', async () => {
    const { storageChangeListeners } = createChromeMock();
    const onDictionaryLoaded = vi.fn();
    const dictionaryLoader = await import('../packages/extension/src/content/dictionary-loader.js');
    vi.mocked(dictionaryLoader.loadDictionary).mockResolvedValue(['巴士专用道']);
    vi.mocked(dictionaryLoader.loadCustomTerms)
      .mockResolvedValueOnce(['德士'])
      .mockResolvedValueOnce(['德士', '陆交局']);

    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `<div id="editor" contenteditable="true" aria-label="Draft body">德士</div>`;
    const editor = document.getElementById('editor') as HTMLElement;
    mockRect(editor);

    await initChecker(onDictionaryLoaded);
    await waitForChecks();

    expect(onDictionaryLoaded).toHaveBeenLastCalledWith(['巴士专用道', '德士']);

    storageChangeListeners[0]?.({
      stet_custom_terms: {
        oldValue: ['德士'],
        newValue: ['德士', '陆交局'],
      },
    }, 'sync');
    await waitForChecks();

    expect(vi.mocked(dictionaryLoader.loadCustomTerms)).toHaveBeenCalledTimes(2);
    expect(onDictionaryLoaded).toHaveBeenLastCalledWith(['巴士专用道', '德士', '陆交局']);
  });

  it('creates a textarea mirror and annotates it inline for textarea-based editors', async () => {
    createChromeMock();
    const { initChecker } = await import('../packages/extension/src/content/checker.js');

    document.body.innerHTML = `
      <label for="cpiArticleInstructions">Additional instructions</label>
      <textarea id="cpiArticleInstructions" aria-label="Additional instructions"></textarea>
    `;

    const textarea = document.getElementById('cpiArticleInstructions') as HTMLTextAreaElement;
    mockRect(textarea, 640, 120);

    await initChecker();

    const mirror = textarea.nextElementSibling as HTMLElement | null;
    expect(mirror?.dataset.stetTextareaMirror).toBe('true');
    expect(textarea.style.display).toBe('none');

    mirror!.textContent = 'teh draft';
    mirror!.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    mirror!.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChecks();

    expect(textarea.value).toBe('teh draft');
    expect(mirror?.querySelectorAll('stet-mark')).toHaveLength(1);
  });
});
