// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  getAnnotationSupport,
  supportsInlineAnnotationMarkup,
} from '../packages/extension/src/content/editable-target.js';

describe('supportsInlineAnnotationMarkup', () => {
  it('allows ordinary block-structured rich text contenteditables', () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true">
        <p>Hello <strong>world</strong></p>
        <div>Second line</div>
      </div>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    expect(supportsInlineAnnotationMarkup(editor)).toBe(true);
    expect(getAnnotationSupport(editor)).toEqual({
      mode: 'inline',
      reason: 'safe-rich-text-dom',
    });
  });

  it('blocks contenteditable editors that already contain host-owned inline elements', () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true">
        Headline <span class="fig-ref">0.3 per cent</span> body
      </div>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    expect(supportsInlineAnnotationMarkup(editor)).toBe(false);
  });

  it('keeps plain text controls in panel mode', () => {
    document.body.innerHTML = `<textarea id="editor">Draft body</textarea>`;

    const editor = document.getElementById('editor') as HTMLTextAreaElement;
    expect(supportsInlineAnnotationMarkup(editor)).toBe(false);
    expect(getAnnotationSupport(editor)).toEqual({
      mode: 'panel',
      reason: 'plain-text-control',
    });
  });

  it('treats known host-managed rich-text roots as panel-only surfaces', () => {
    document.body.innerHTML = `
      <div id="editor" class="ProseMirror" contenteditable="true">
        <p>Hosted editor text</p>
      </div>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    expect(supportsInlineAnnotationMarkup(editor)).toBe(false);
    expect(getAnnotationSupport(editor)).toEqual({
      mode: 'panel',
      reason: 'host-managed-editor',
    });
  });
});
