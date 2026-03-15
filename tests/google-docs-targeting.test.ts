// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  discoverHistoryEditables,
  findHistoryEditable,
  getAnnotationSupport,
  getEditableTarget,
  isGoogleDocsEditableRoot,
} from '../packages/extension/src/content/editable-target.js';
import { extractGoogleDocsRenderedText } from '../packages/extension/src/content/google-docs-surface.js';

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
});
