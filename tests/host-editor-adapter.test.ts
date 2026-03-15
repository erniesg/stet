// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverAnnotatableEditables,
  findAnnotatableEditable,
  getEditableTarget,
  replaceEditableRange,
  replaceEditableText,
} from '../packages/extension/src/content/editable-target.js';

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

describe('BTEditor host adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.btAiEditor;
    delete window.btAiEditors;
    delete window.btEditor;
    delete window.btEditors;
    delete window.__BT_AI_EDITORS__;
    delete window.__BT_EDITORS__;
    delete window.__STET_HOST_EDITORS__;
    delete window.__stetHostEditors__;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.btAiEditor;
    delete window.btAiEditors;
    delete window.btEditor;
    delete window.btEditors;
    delete window.__BT_AI_EDITORS__;
    delete window.__BT_EDITORS__;
    delete window.__STET_HOST_EDITORS__;
    delete window.__stetHostEditors__;
    vi.restoreAllMocks();
  });

  it('routes editable target reads and writes through the BTEditor API', () => {
    document.body.innerHTML = `<div id="bt-editor-content" contenteditable="true" aria-label="Body"></div>`;

    const editor = document.getElementById('bt-editor-content') as HTMLElement;
    mockRect(editor);

    const onInput = vi.fn();
    const onChange = vi.fn();
    editor.addEventListener('input', onInput);
    editor.addEventListener('change', onChange);

    let plainText = 'Current draft';
    const getText = vi.fn(() => plainText);
    const setText = vi.fn((text: string) => {
      plainText = text;
      editor.innerHTML = `<span class="fig-ref">${text}</span>`;
    });

    window.btEditor = {
      contentEl: editor,
      getText,
      setText,
    };

    const target = getEditableTarget(editor);

    expect(target).not.toBeNull();
    expect(target!.read()).toBe('Current draft');

    target!.write('Updated draft');

    expect(setText).toHaveBeenCalledWith('Updated draft');
    expect(editor.querySelector('.fig-ref')?.textContent).toBe('Updated draft');
    expect(onInput).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('falls back to full-text writes instead of mutating BTEditor ranges directly', () => {
    document.body.innerHTML = `<div id="bt-editor-content" contenteditable="true" aria-label="Body">Alpha beta</div>`;

    const editor = document.getElementById('bt-editor-content') as HTMLElement;
    mockRect(editor);

    const setText = vi.fn((text: string) => {
      editor.innerHTML = `<span class="fig-ref">${text}</span>`;
    });

    window.btEditor = {
      contentEl: editor,
      getText: () => 'Alpha beta',
      setText,
    };

    expect(replaceEditableRange(editor, 0, 5, 'Gamma')).toBe(false);

    replaceEditableText(editor, 'Gamma beta');

    expect(setText).toHaveBeenCalledWith('Gamma beta');
    expect(editor.querySelector('.fig-ref')?.textContent).toBe('Gamma beta');
  });

  it('discovers and routes BT AI editors registered through a registry object', () => {
    document.body.innerHTML = `
      <section id="shell">
        <div id="rewrite-editor" aria-label="Rewrite Body">
          <div class="rendered">Rendered rewrite draft</div>
        </div>
      </section>
    `;

    const editor = document.getElementById('rewrite-editor') as HTMLElement;
    mockRect(editor);

    let plainText = 'Rewrite draft from adapter';
    const readText = vi.fn(() => plainText);
    const writeText = vi.fn((text: string) => {
      plainText = text;
      editor.querySelector('.rendered')!.textContent = text;
    });

    window.btEditors = {
      rewrite: {
        element: editor,
        readText,
        writeText,
      },
    };

    expect(findAnnotatableEditable(editor.querySelector('.rendered'))).toBe(editor);
    expect(discoverAnnotatableEditables()).toContain(editor);

    const target = getEditableTarget(editor);

    expect(target).not.toBeNull();
    expect(target!.read()).toBe('Rewrite draft from adapter');

    target!.write('Updated rewrite draft');

    expect(writeText).toHaveBeenCalledWith('Updated rewrite draft');
    expect(editor.querySelector('.rendered')?.textContent).toBe('Updated rewrite draft');
  });

  it('uses adapter range replacement when a BT AI editor exposes it', () => {
    document.body.innerHTML = `<div id="headline-editor" aria-label="Headline"></div>`;

    const editor = document.getElementById('headline-editor') as HTMLElement;
    mockRect(editor, 320, 40);

    let plainText = 'Alpha beta';
    const replaceRange = vi.fn((start: number, end: number, replacement: string) => {
      plainText = `${plainText.slice(0, start)}${replacement}${plainText.slice(end)}`;
      return true;
    });

    window.__BT_AI_EDITORS__ = [
      {
        element: editor,
        getText: () => plainText,
        setText: vi.fn(),
        replaceRange,
      },
    ];

    expect(replaceEditableRange(editor, 0, 5, 'Gamma')).toBe(true);
    expect(replaceRange).toHaveBeenCalledWith(0, 5, 'Gamma');
    expect(getEditableTarget(editor)?.read()).toBe('Gamma beta');
  });
});
