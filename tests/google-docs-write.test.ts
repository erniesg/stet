// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  applyGoogleDocsReplacement,
  replaceGoogleDocsText,
} from '../packages/extension/src/content/google-docs-write.js';
import { extractGoogleDocsRenderedText } from '../packages/extension/src/content/google-docs-surface.js';

function setGoogleDocsLocation() {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('https://docs.google.com/document/d/abc/edit'),
  });
}

function mockRect(element: HTMLElement, left: number, top: number, width: number, height: number) {
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

function createFakeGoogleDocsEditor(
  initialText: string,
  options: { faultyDelete?: boolean } = {},
) {
  setGoogleDocsLocation();

  document.body.innerHTML = `
    <div id="docs-editor">
      <div id="docs-root" class="kix-appview-editor"></div>
      <div class="kix-cursor"><div class="kix-cursor-caret"></div></div>
    </div>
    <iframe class="docs-texteventtarget-iframe"></iframe>
  `;

  const root = document.getElementById('docs-root') as HTMLElement;
  const iframe = document.querySelector('iframe.docs-texteventtarget-iframe') as HTMLIFrameElement;
  const iframeDoc = document.implementation.createHTMLDocument('');
  iframeDoc.body.innerHTML = '<div contenteditable="true"></div>';

  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    value: iframeDoc,
  });

  const state = {
    text: initialText,
    selectionStart: initialText.length,
    selectionEnd: initialText.length,
  };
  const undoStack: Array<{ text: string; selectionStart: number; selectionEnd: number }> = [];

  const pushUndoState = () => {
    undoStack.push({
      text: state.text,
      selectionStart: state.selectionStart,
      selectionEnd: state.selectionEnd,
    });
  };

  const render = () => {
    root.innerHTML = `
      <div class="kix-page-paginated">
        <div class="kix-lineview">
          <div class="kix-lineview-text-block"></div>
        </div>
      </div>
    `;

    const page = root.querySelector('.kix-page-paginated') as HTMLElement;
    const line = root.querySelector('.kix-lineview') as HTMLElement;
    const lineText = root.querySelector('.kix-lineview-text-block') as HTMLElement;
    const caret = document.querySelector('.kix-cursor-caret') as HTMLElement;

    lineText.textContent = state.text;

    const tokenMatches = [...state.text.matchAll(/\S+/g)];
    for (const match of tokenMatches) {
      const word = document.createElement('span');
      word.className = 'kix-wordhtmlgenerator-word-node';
      word.textContent = match[0];
      line.appendChild(word);
    }

    mockRect(root, 20, 20, 860, 1080);
    mockRect(page, 40, 40, 820, 1040);
    mockRect(line, 80, 120, Math.max(8, state.text.length * 8), 20);
    mockRect(lineText, 80, 120, Math.max(8, state.text.length * 8), 20);

    const wordNodes = line.querySelectorAll('.kix-wordhtmlgenerator-word-node');
    tokenMatches.forEach((match, index) => {
      const token = wordNodes[index] as HTMLElement;
      mockRect(token, 80 + (match.index! * 8), 120, Math.max(8, match[0].length * 8), 18);
    });

    mockRect(caret, 80 + (state.selectionEnd * 8), 120, 1, 18);
  };

  const deleteSelection = () => {
    const start = Math.min(state.selectionStart, state.selectionEnd);
    const end = Math.max(state.selectionStart, state.selectionEnd);
    if (start === end) return false;
    pushUndoState();
    state.text = `${state.text.slice(0, start)}${state.text.slice(end)}`;
    state.selectionStart = start;
    state.selectionEnd = start;
    return true;
  };

  const insertText = (text: string) => {
    const hadSelection = deleteSelection();
    if (!hadSelection) {
      pushUndoState();
    }
    const caret = state.selectionEnd;
    state.text = `${state.text.slice(0, caret)}${text}${state.text.slice(caret)}`;
    state.selectionStart = caret + text.length;
    state.selectionEnd = caret + text.length;
  };

  const restoreUndoState = () => {
    const previous = undoStack.pop();
    if (!previous) return false;
    state.text = previous.text;
    state.selectionStart = previous.selectionStart;
    state.selectionEnd = previous.selectionEnd;
    return true;
  };

  iframeDoc.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      restoreUndoState();
      render();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      state.selectionStart = 0;
      state.selectionEnd = state.text.length;
      render();
      return;
    }

    if (event.key === 'ArrowLeft') {
      const next = Math.max(0, state.selectionEnd - 1);
      if (event.shiftKey) {
        state.selectionEnd = next;
      } else {
        state.selectionStart = next;
        state.selectionEnd = next;
      }
      render();
      return;
    }

    if (event.key === 'ArrowRight') {
      const next = Math.min(state.text.length, state.selectionEnd + 1);
      if (event.shiftKey) {
        state.selectionEnd = next;
      } else {
        state.selectionStart = next;
        state.selectionEnd = next;
      }
      render();
      return;
    }

    if (event.key === 'Backspace') {
      if (!deleteSelection() && state.selectionEnd > 0) {
        pushUndoState();
        state.text = `${state.text.slice(0, state.selectionEnd - 1)}${state.text.slice(state.selectionEnd)}`;
        state.selectionStart -= 1;
        state.selectionEnd -= 1;
      }
      render();
      return;
    }

    if (event.key === 'Delete') {
      if (!deleteSelection() && state.selectionEnd < state.text.length) {
        pushUndoState();
        const deleteCount = options.faultyDelete ? 2 : 1;
        state.text = `${state.text.slice(0, state.selectionEnd)}${state.text.slice(state.selectionEnd + deleteCount)}`;
      }
      render();
      return;
    }

    if (event.key === 'Enter') {
      insertText('\n');
      render();
    }
  });

  iframeDoc.addEventListener('keypress', (event) => {
    if (!event.key) return;
    insertText(event.key);
    render();
  });

  render();

  const setCaret = (offset: number) => {
    state.selectionStart = offset;
    state.selectionEnd = offset;
    render();
  };

  return { root, state, setCaret };
}

describe('google docs write helpers', () => {
  it('applies a targeted replacement without consuming adjacent text', async () => {
    const { root, state, setCaret } = createFakeGoogleDocsEditor('Once upon a time there was a pig 13% of it');
    const sourceText = extractGoogleDocsRenderedText(root);
    const start = sourceText.indexOf('13%');

    setCaret(sourceText.length);
    const applied = await applyGoogleDocsReplacement(root, start, start + 3, '13 per cent', sourceText);

    expect(applied).toBe(true);
    expect(state.text).toBe('Once upon a time there was a pig 13 per cent of it');
    expect(extractGoogleDocsRenderedText(root)).toBe('Once upon a time there was a pig 13 per cent of it');
  });

  it('reverts unexpected mutations instead of leaving a corrupted document', async () => {
    const { root, state, setCaret } = createFakeGoogleDocsEditor('Once upon a time there was a pig 13% of it', {
      faultyDelete: true,
    });
    const sourceText = extractGoogleDocsRenderedText(root);
    const start = sourceText.indexOf('13%');

    setCaret(sourceText.length);
    const applied = await applyGoogleDocsReplacement(root, start, start + 3, '13 per cent', sourceText);

    expect(applied).toBe(false);
    expect(state.text).toBe(sourceText);
    expect(extractGoogleDocsRenderedText(root)).toBe(sourceText);
  });

  it('replaces the full document contents through the docs shortcut path', () => {
    const { root, state } = createFakeGoogleDocsEditor('Draft body');

    const applied = replaceGoogleDocsText(root, 'Rewritten body');

    expect(applied).toBe(true);
    expect(state.text).toBe('Rewritten body');
    expect(extractGoogleDocsRenderedText(root)).toBe('Rewritten body');
  });
});
