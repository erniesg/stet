// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findHistoryEditable,
  getEditableTarget,
} from '../packages/extension/src/content/editable-target.js';
import { DEFAULT_HISTORY_POLICY } from '../packages/extension/src/content/version-history-core.js';
import { VersionHistoryManager } from '../packages/extension/src/content/version-history-manager.js';
import {
  loadHistoryRecordByFieldKey,
  loadHistoryRecordForTarget,
  saveSnapshotForTarget,
} from '../packages/extension/src/content/version-history-store.js';
import type { HistoryRuntimeConfig } from '../packages/extension/src/history-settings.js';

function createRuntime(overrides: Partial<HistoryRuntimeConfig> = {}): HistoryRuntimeConfig {
  return {
    enabled: true,
    requestedUiMode: 'field',
    allowAnchoredUi: true,
    debug: false,
    reason: null,
    ...overrides,
  };
}

function createChromeMock() {
  const storage = new Map<string, unknown>();

  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn(),
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

  return storage;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getListenerCalls(spy: ReturnType<typeof vi.spyOn>, type: string) {
  return spy.mock.calls.filter(([eventName]) => eventName === type);
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

describe('version history dom integration', () => {
  beforeEach(() => {
    createChromeMock();
    document.body.innerHTML = '';
    window.__stetHistoryDebug = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('resolves wrapper-focused editors to the contained editable element', () => {
    document.body.innerHTML = `
      <section id="story-editor">
        <div class="editor-shell" role="textbox" tabindex="0" aria-label="Story body shell">
          <div class="editor-toolbar"><button type="button">Bold</button></div>
          <div id="story-body" contenteditable="true" aria-label="Story body"></div>
        </div>
      </section>
    `;

    const shell = document.querySelector('.editor-shell') as HTMLElement;
    const editor = document.getElementById('story-body') as HTMLElement;
    mockRect(editor);

    expect(findHistoryEditable(shell)).toBe(editor);
  });

  it('does not treat generic application shells as editor ownership hints', () => {
    document.body.innerHTML = `
      <div id="app-shell" role="application">
        <button id="nav" type="button">Inbox</button>
        <div id="story-body" contenteditable="true" aria-label="Story body"></div>
      </div>
    `;

    const nav = document.getElementById('nav') as HTMLButtonElement;
    const editor = document.getElementById('story-body') as HTMLElement;
    mockRect(editor);

    expect(findHistoryEditable(nav)).toBeNull();
  });

  it('binds history listeners only to the active editor', () => {
    document.body.innerHTML = `
      <div id="first" contenteditable="true" aria-label="First field"></div>
      <div id="second" contenteditable="true" aria-label="Second field"></div>
    `;

    const first = document.getElementById('first') as HTMLElement;
    const second = document.getElementById('second') as HTMLElement;
    mockRect(first);
    mockRect(second);
    const firstAdd = vi.spyOn(first, 'addEventListener');
    const firstRemove = vi.spyOn(first, 'removeEventListener');
    const secondAdd = vi.spyOn(second, 'addEventListener');
    const manager = new VersionHistoryManager(createRuntime());

    manager.init();

    expect(getListenerCalls(firstAdd, 'input')).toHaveLength(0);
    expect(getListenerCalls(secondAdd, 'input')).toHaveLength(0);

    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(getListenerCalls(firstAdd, 'input')).toHaveLength(1);
    expect(getListenerCalls(secondAdd, 'input')).toHaveLength(0);

    second.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(getListenerCalls(firstRemove, 'input')).toHaveLength(1);
    expect(getListenerCalls(secondAdd, 'input')).toHaveLength(1);

    manager.destroy();
  });

  it('activates wrapper-driven editors and preserves history across remounts', async () => {
    document.body.innerHTML = `
      <section id="story-editor">
        <div class="editor-shell" role="textbox" tabindex="0">
          <div id="story-body" contenteditable="true" aria-label="Story body" data-testid="story-body"></div>
        </div>
      </section>
    `;

    const shell = document.querySelector('.editor-shell') as HTMLElement;
    const editor = document.getElementById('story-body') as HTMLElement;
    mockRect(editor);
    const manager = new VersionHistoryManager(createRuntime());

    manager.init();
    shell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const button = document.querySelector('.stet-history-button') as HTMLButtonElement;
    expect(button.hidden).toBe(false);

    editor.textContent = 'First body draft.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await flushAsyncWork();

    const firstTarget = getEditableTarget(editor);
    expect(firstTarget).not.toBeNull();

    const firstRecord = await loadHistoryRecordForTarget(firstTarget!);
    expect(firstRecord?.snapshots.at(-1)?.content).toBe('First body draft.');

    document.querySelector('#story-editor')!.innerHTML = `
      <div class="editor-shell remounted" role="textbox" tabindex="0">
        <div class="chrome"></div>
        <div id="story-body-next" contenteditable="true" aria-label="Story body" data-testid="story-body"></div>
      </div>
    `;
    await flushAsyncWork();

    const nextShell = document.querySelector('.editor-shell.remounted') as HTMLElement;
    const remountedEditor = document.getElementById('story-body-next') as HTMLElement;
    mockRect(remountedEditor);
    nextShell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushAsyncWork();

    const remountedTarget = getEditableTarget(remountedEditor);
    expect(remountedTarget).not.toBeNull();
    expect(remountedTarget?.fieldKey).toBe(firstTarget?.fieldKey);

    const remountedRecord = await loadHistoryRecordForTarget(remountedTarget!);
    expect(remountedRecord?.snapshots.at(-1)?.content).toBe('First body draft.');

    await saveSnapshotForTarget(
      remountedTarget!,
      'Second body draft.',
      'manual',
      DEFAULT_HISTORY_POLICY,
      true,
    );

    const updatedRecord = await loadHistoryRecordForTarget(remountedTarget!);
    expect(updatedRecord?.snapshots).toHaveLength(2);

    manager.destroy();
  });

  it('loads stored history by field key after the live editor disappears', async () => {
    document.body.innerHTML = `
      <textarea id="draft" aria-label="Draft body"></textarea>
    `;

    const editor = document.getElementById('draft') as HTMLTextAreaElement;
    mockRect(editor);
    const target = getEditableTarget(editor);
    expect(target).not.toBeNull();

    await saveSnapshotForTarget(
      target!,
      'Detached draft body.',
      'manual',
      DEFAULT_HISTORY_POLICY,
      true,
    );

    editor.remove();
    await flushAsyncWork();

    const detachedRecord = await loadHistoryRecordByFieldKey(target!.fieldKey);
    expect(detachedRecord?.label).toBe('Draft body');
    expect(detachedRecord?.snapshots.at(-1)?.content).toBe('Detached draft body.');
  });

  it('clears the in-page history ui after the editor loses focus', async () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true" aria-label="Story body"></div>
      <button id="outside" type="button">Outside</button>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    const outside = document.getElementById('outside') as HTMLButtonElement;
    mockRect(editor);

    const manager = new VersionHistoryManager(createRuntime({ requestedUiMode: 'field', allowAnchoredUi: true }));
    manager.init();

    editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const button = document.querySelector('.stet-history-button') as HTMLButtonElement;
    expect(button.hidden).toBe(false);

    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    await flushAsyncWork();

    expect(button.hidden).toBe(true);

    manager.destroy();
  });

  it('treats a legacy page-mode runtime as field-mode chrome', async () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true" aria-label="Story body"></div>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    mockRect(editor);

    const manager = new VersionHistoryManager(createRuntime({ requestedUiMode: 'page', allowAnchoredUi: true }));
    manager.init();

    editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushAsyncWork();

    const root = document.querySelector('.stet-history-root') as HTMLElement;
    expect(root.classList.contains('is-field-mode')).toBe(true);

    manager.destroy();
  });

  it('closes the field-mode panel on outside pointer interaction', async () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true" aria-label="Story body"></div>
      <button id="outside" type="button">Outside</button>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    const outside = document.getElementById('outside') as HTMLButtonElement;
    mockRect(editor);

    const manager = new VersionHistoryManager(createRuntime({ requestedUiMode: 'field', allowAnchoredUi: true }));
    manager.init();

    editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flushAsyncWork();

    const button = document.querySelector('.stet-history-button') as HTMLButtonElement;
    button.click();
    await flushAsyncWork();

    const panel = document.querySelector('.stet-history-panel') as HTMLElement;
    expect(panel.hidden).toBe(false);

    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);

    manager.destroy();
  });
});
