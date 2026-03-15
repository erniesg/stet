// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { AnnotationManager } from '../packages/extension/src/content/annotation-manager.js';

describe('AnnotationManager inline selection restore', () => {
  it('preserves a trailing-space caret on plaintext textarea mirrors', () => {
    document.body.innerHTML = `
      <div
        id="mirror"
        contenteditable="plaintext-only"
        data-stet-textarea-mirror="true"
      >boi </div>
    `;

    const mirror = document.getElementById('mirror') as HTMLElement;
    Object.defineProperty(mirror, 'innerText', {
      configurable: true,
      get() {
        return (this.textContent || '').trimEnd();
      },
    });

    const selection = document.getSelection();
    expect(selection).not.toBeNull();

    const initialTextNode = mirror.firstChild as Text;
    const range = document.createRange();
    range.setStart(initialTextNode, 4);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);

    const manager = new AnnotationManager(mirror);
    manager.annotate([
      {
        rule: 'BT-SPELL-01',
        severity: 'warning',
        offset: 0,
        length: 3,
        originalText: 'boi',
        suggestion: 'boy',
        description: 'Spelling issue',
        canFix: true,
      },
    ], 'inline');

    expect(mirror.querySelectorAll('stet-mark')).toHaveLength(1);
    expect(mirror.textContent).toBe('boi ');

    const restoredSelection = document.getSelection();
    expect(restoredSelection?.anchorNode?.textContent).toBe(' ');
    expect(restoredSelection?.anchorOffset).toBe(1);
    expect(restoredSelection?.focusNode?.textContent).toBe(' ');
    expect(restoredSelection?.focusOffset).toBe(1);

    manager.destroy();
  });
});
