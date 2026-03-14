// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { supportsInlineAnnotationMarkup } from '../packages/extension/src/content/editable-target.js';

describe('supportsInlineAnnotationMarkup', () => {
  it('allows plain contenteditable text with line breaks', () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true">Hello<br>world</div>
    `;

    const editor = document.getElementById('editor') as HTMLElement;
    expect(supportsInlineAnnotationMarkup(editor)).toBe(true);
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

  it('treats textarea elements as safe for direct annotations', () => {
    document.body.innerHTML = `<textarea id="editor">Draft body</textarea>`;

    const editor = document.getElementById('editor') as HTMLTextAreaElement;
    expect(supportsInlineAnnotationMarkup(editor)).toBe(true);
  });
});
