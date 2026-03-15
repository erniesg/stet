// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnnotationManager } from '../packages/extension/src/content/annotation-manager.js';

describe('AnnotationManager overlay visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

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
  });

  it('suppresses overlay marks and cards during external interactions and restores them for the editor', () => {
    const editor = document.createElement('div');
    editor.textContent = 'Alpha while beta';
    document.body.appendChild(editor);

    const externalTrigger = document.createElement('button');
    externalTrigger.type = 'button';
    externalTrigger.textContent = 'Open preview';
    document.body.appendChild(externalTrigger);

    const manager = new AnnotationManager(editor);
    manager.annotate([
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
    ], 'overlay');

    const overlayMark = document.querySelector('.stet-overlay-mark') as HTMLButtonElement | null;
    expect(overlayMark).not.toBeNull();

    overlayMark?.click();
    expect(document.querySelector('.stet-card')).not.toBeNull();

    externalTrigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    const hiddenOverlayRoot = document.querySelector('.stet-overlay-root') as HTMLElement | null;
    expect(hiddenOverlayRoot).not.toBeNull();
    expect(hiddenOverlayRoot?.hidden).toBe(true);
    expect(document.querySelector('.stet-card')).toBeNull();

    editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const restoredOverlayRoot = document.querySelector('.stet-overlay-root') as HTMLElement | null;
    expect(restoredOverlayRoot).not.toBeNull();
    expect(restoredOverlayRoot?.hidden).toBe(false);
    expect(document.querySelectorAll('.stet-overlay-mark')).toHaveLength(1);

    manager.destroy();
  });

  it('keeps the mark visible when applying a fix fails', async () => {
    const editor = document.createElement('div');
    editor.textContent = 'Alpha while beta';
    document.body.appendChild(editor);

    const manager = new AnnotationManager(editor, {
      onApplyIssue: async () => false,
    });

    manager.annotate([
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
    ], 'overlay');

    const overlayMark = document.querySelector('.stet-overlay-mark') as HTMLButtonElement | null;
    expect(overlayMark).not.toBeNull();

    overlayMark?.click();
    const chip = document.querySelector('.stet-suggestion-chip') as HTMLButtonElement | null;
    expect(chip).not.toBeNull();

    chip?.click();
    await Promise.resolve();

    expect(document.querySelectorAll('.stet-overlay-mark')).toHaveLength(1);

    manager.destroy();
  });
});
