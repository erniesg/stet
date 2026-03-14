// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    delete window.btEditor;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.btEditor;
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
});
