// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  discoverHistoryEditables,
  findHistoryEditable,
  getAnnotationSupport,
  getEditableTarget,
  isGoogleDocsEditableRoot,
} from '../packages/extension/src/content/editable-target.js';
import {
  extractGoogleDocsRenderedText,
  isGoogleDocsChromeMutation,
  measureGoogleDocsTextWidth,
} from '../packages/extension/src/content/google-docs-surface.js';

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

describe('google docs targeting', () => {
  it('treats the visible docs root as the only history target on docs.google.com', () => {
    setGoogleDocsLocation();

    document.body.innerHTML = `
      <div id="docs-editor-container">
        <div id="docs-editor">
          <div id="docs-root" class="kix-appview-editor">
            <div class="kix-page-paginated">
              <div class="kix-lineview">
                <div class="kix-lineview-text-block">Alpha beta thmme gamma</div>
                <span class="kix-wordhtmlgenerator-word-node">Alpha beta </span>
                <span class="kix-wordhtmlgenerator-word-node">thmme</span>
                <span class="kix-wordhtmlgenerator-word-node"> gamma</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="scratch" contenteditable="true">sidebar scratchpad</div>
      <iframe class="docs-texteventtarget-iframe"></iframe>
    `;

    const container = document.getElementById('docs-editor-container') as HTMLElement;
    const editor = document.getElementById('docs-editor') as HTMLElement;
    const root = document.getElementById('docs-root') as HTMLElement;
    const word = root.querySelectorAll<HTMLElement>('.kix-wordhtmlgenerator-word-node')[1];
    const scratch = document.getElementById('scratch') as HTMLElement;

    mockRect(container, 0, 0, 960, 1200);
    mockRect(editor, 20, 20, 900, 1120);
    mockRect(root, 30, 30, 860, 1080);
    mockRect(word, 180, 120, 50, 18);
    mockRect(scratch, 0, 0, 400, 120);

    expect(isGoogleDocsEditableRoot(container)).toBe(false);
    expect(isGoogleDocsEditableRoot(editor)).toBe(false);
    expect(isGoogleDocsEditableRoot(root)).toBe(true);
    expect(discoverHistoryEditables()).toEqual([root]);
    expect(findHistoryEditable(word)).toBe(root);
    expect(findHistoryEditable(scratch)).toBeNull();
    expect(getAnnotationSupport(root)).toEqual({
      mode: 'overlay',
      reason: 'google-docs-rendered-surface',
    });
    expect(getEditableTarget(root)?.label).toBe('Quarterly update');
  });

  it('falls back to panel mode when Docs text exists but rendered word geometry is unavailable', () => {
    setGoogleDocsLocation();

    document.body.innerHTML = `
      <div id="docs-editor">
        <div id="docs-root" class="kix-appview-editor">
          <div class="kix-page-paginated"></div>
        </div>
      </div>
      <iframe class="docs-texteventtarget-iframe"></iframe>
    `;

    const root = document.getElementById('docs-root') as HTMLElement;
    const page = root.querySelector('.kix-page-paginated') as HTMLElement;
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe') as HTMLIFrameElement;
    const iframeDoc = document.implementation.createHTMLDocument('');
    iframeDoc.body.innerHTML = '<div contenteditable="true">Alpha beta thmme gamma</div>';

    Object.defineProperty(iframe, 'contentDocument', {
      configurable: true,
      value: iframeDoc,
    });

    mockRect(root, 30, 30, 860, 1080);
    mockRect(page, 40, 40, 820, 1040);

    expect(getAnnotationSupport(root)).toEqual({
      mode: 'panel',
      reason: 'google-docs-text-only',
    });
  });

  it('extracts docs text from aria-label SVG rects when HTML word nodes are absent', () => {
    setGoogleDocsLocation();

    document.body.innerHTML = `
      <div id="docs-editor">
        <div id="docs-root" class="kix-appview-editor">
          <svg>
            <g>
              <rect id="rect-1" aria-label="Alpha" x="80" y="120" width="40" height="18"></rect>
              <rect id="rect-2" aria-label="beta" x="126" y="120" width="32" height="18"></rect>
              <rect id="rect-3" aria-label="thmme" x="164" y="120" width="40" height="18"></rect>
              <rect id="rect-4" aria-label="gamma" x="210" y="120" width="48" height="18"></rect>
            </g>
          </svg>
        </div>
      </div>
      <iframe class="docs-texteventtarget-iframe"></iframe>
    `;

    const root = document.getElementById('docs-root') as HTMLElement;
    mockRect(root, 30, 30, 860, 1080);
    mockRect(document.getElementById('rect-1')!, 80, 120, 40, 18);
    mockRect(document.getElementById('rect-2')!, 126, 120, 32, 18);
    mockRect(document.getElementById('rect-3')!, 164, 120, 40, 18);
    mockRect(document.getElementById('rect-4')!, 210, 120, 48, 18);

    expect(extractGoogleDocsRenderedText(root)).toBe('Alpha beta thmme gamma');
    expect(getAnnotationSupport(root)).toEqual({
      mode: 'overlay',
      reason: 'google-docs-rendered-surface',
    });
    expect(discoverHistoryEditables()).toEqual([root]);
  });

  it('treats cursor chrome-only docs mutations as ignorable', async () => {
    setGoogleDocsLocation();

    document.body.innerHTML = `
      <div id="docs-root" class="kix-appview-editor">
        <div id="cursor" class="kix-cursor"><div class="kix-cursor-caret"></div></div>
      </div>
    `;

    const root = document.getElementById('docs-root') as HTMLElement;
    const cursor = document.getElementById('cursor') as HTMLElement;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });

    cursor.innerHTML = '<div class="kix-selection-overlay"></div><div class="kix-cursor-caret"></div>';
    cursor.style.left = '120px';
    const overlay = document.createElement('div');
    overlay.className = 'kix-selection-overlay';
    root.appendChild(overlay);
    overlay.remove();

    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();

    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((mutation) => isGoogleDocsChromeMutation(mutation))).toBe(true);
  });

  it('measures docs text without mutating the document when canvas measurement is available', async () => {
    const source = document.createElement('span');
    source.textContent = 'Alpha';
    source.style.font = '400 24px Arial';
    source.style.letterSpacing = '2px';
    document.body.appendChild(source);

    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: vi.fn(() => ({ width: 40 })),
    } as unknown as CanvasRenderingContext2D);

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    const width = measureGoogleDocsTextWidth('Alpha', source);
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    getContextSpy.mockRestore();

    expect(width).toBe(48);
    expect(mutations).toHaveLength(0);
  });
});
