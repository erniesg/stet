// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockRect(element: HTMLElement, width = 320, height = 120) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 40,
      left: 24,
      right: 24 + width,
      bottom: 40 + height,
      x: 24,
      y: 40,
      toJSON: () => ({}),
    }),
  });
}

describe('on-page UI visibility', () => {
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

    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: (_key: string, callback: (result: Record<string, unknown>) => void) => callback({}),
          set: (_items: Record<string, unknown>, callback?: () => void) => callback?.(),
          remove: (_keys: string[], callback?: () => void) => callback?.(),
        },
      },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as { isContentEditable?: boolean }).isContentEditable;
    vi.restoreAllMocks();
  });

  it('keeps version history UI hidden until an editable is focused', async () => {
    const { VersionHistoryManager } = await import('../packages/extension/src/content/version-history-manager.js');

    document.body.innerHTML = `<textarea id="draft" aria-label="Draft body"></textarea>`;
    const textarea = document.getElementById('draft') as HTMLTextAreaElement;
    mockRect(textarea);

    const manager = new VersionHistoryManager({
      enabled: true,
      requestedUiMode: 'field',
      allowAnchoredUi: true,
      debug: false,
      reason: null,
    });

    manager.init();

    const root = document.querySelector('.stet-history-root') as HTMLElement;
    const button = document.querySelector('.stet-history-button') as HTMLElement;
    const panel = document.querySelector('.stet-history-panel') as HTMLElement;

    expect(root.style.display).toBe('none');
    expect(button.style.display).toBe('none');
    expect(panel.style.display).toBe('none');

    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.style.display).toBe('flex');
    expect(button.style.display).toBe('flex');
    expect(panel.style.display).toBe('none');

    manager.destroy();
  });

  it('keeps the issue panel UI hidden until an editable is active', async () => {
    const { IssuePanelManager } = await import('../packages/extension/src/content/issue-panel.js');

    document.body.innerHTML = `<textarea id="draft" aria-label="Draft body"></textarea>`;
    const textarea = document.getElementById('draft') as HTMLTextAreaElement;

    const manager = new IssuePanelManager(async () => 0);

    const root = document.querySelector('.stet-issues-root') as HTMLElement;
    const button = document.querySelector('.stet-issues-button') as HTMLElement;
    const panel = document.querySelector('.stet-issues-panel') as HTMLElement;

    expect(root.style.display).toBe('none');
    expect(button.style.display).toBe('none');
    expect(panel.style.display).toBe('none');

    manager.setActiveElement(textarea);
    manager.updateIssues(textarea, []);

    expect(root.style.display).toBe('flex');
    expect(button.style.display).toBe('flex');
    expect(panel.style.display).toBe('none');
  });
});
