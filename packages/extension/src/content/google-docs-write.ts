import {
  buildGoogleDocsWordEntries,
  extractGoogleDocsRenderedText,
  measureGoogleDocsTextWidth,
} from './google-docs-surface.js';

const GOOGLE_DOCS_CURSOR_SELECTOR = '.kix-cursor';
const GOOGLE_DOCS_CURSOR_CARET_SELECTOR = '.kix-cursor-caret';
const GOOGLE_DOCS_SELECTION_SELECTOR = '.kix-selection-overlay';
const GOOGLE_DOCS_EVENT_TARGET_SELECTOR = 'iframe.docs-texteventtarget-iframe, .docs-texteventtarget-iframe';
const APPLY_TIMEOUT_MS = 500;

type GoogleDocsInputTarget = Document | HTMLElement;

const rememberedCaretOffsets = new WeakMap<HTMLElement, number>();

export function rememberGoogleDocsCaret(root: HTMLElement, fullText = extractGoogleDocsRenderedText(root)): number | null {
  const offset = getGoogleDocsCaretOffset(root, fullText);
  if (offset !== null) {
    rememberedCaretOffsets.set(root, offset);
  }
  return offset;
}

export async function applyGoogleDocsReplacement(
  root: HTMLElement,
  start: number,
  end: number,
  replacement: string,
  sourceText = extractGoogleDocsRenderedText(root),
): Promise<boolean> {
  const inputTarget = getGoogleDocsInputTarget(root.ownerDocument);
  if (!inputTarget) return false;

  let caretOffset = getGoogleDocsCaretOffset(root, sourceText) ?? rememberedCaretOffsets.get(root) ?? null;
  if (caretOffset === null && !hasGoogleDocsSelection(root.ownerDocument)) {
    focusGoogleDocsTarget(inputTarget);
    await waitForFrame();
    caretOffset = getGoogleDocsCaretOffset(root, sourceText) ?? rememberedCaretOffsets.get(root) ?? null;
  }

  if (caretOffset === null) return false;

  moveCaretByDelta(inputTarget, start - caretOffset);

  if (end > start) {
    extendSelection(inputTarget, end - start);
    pressSpecialKey(inputTarget, 'Backspace', 8);
  }

  typeGoogleDocsText(inputTarget, replacement);

  const expectedText = `${sourceText.slice(0, start)}${replacement}${sourceText.slice(end)}`;
  const applied = await waitForExpectedText(root, expectedText);
  if (applied) {
    rememberedCaretOffsets.set(root, start + replacement.length);
  }
  return applied;
}

export function replaceGoogleDocsText(root: HTMLElement, text: string): boolean {
  const inputTarget = getGoogleDocsInputTarget(root.ownerDocument);
  if (!inputTarget) return false;

  focusGoogleDocsTarget(inputTarget);
  selectAllGoogleDocsText(inputTarget);
  pressSpecialKey(inputTarget, 'Backspace', 8);
  typeGoogleDocsText(inputTarget, text);
  rememberedCaretOffsets.set(root, text.length);
  return true;
}

function getGoogleDocsInputTarget(doc: Document): GoogleDocsInputTarget | null {
  const candidate = doc.querySelector<HTMLElement | HTMLIFrameElement>(GOOGLE_DOCS_EVENT_TARGET_SELECTOR);
  if (!candidate) return null;

  if (candidate instanceof HTMLIFrameElement) {
    return candidate.contentDocument ?? null;
  }

  return candidate;
}

function getGoogleDocsCaretOffset(root: HTMLElement, fullText: string): number | null {
  const caret = getGoogleDocsCursorCaret(root.ownerDocument);
  if (!caret) return null;

  const caretRect = caret.getBoundingClientRect();
  const words = buildGoogleDocsWordEntries(root, fullText);
  if (words.length === 0) return null;

  let bestMatch: (typeof words)[number] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const word of words) {
    const rect = word.rect;
    const verticallyAligned = caretRect.bottom >= rect.top && caretRect.top <= rect.bottom;
    if (!verticallyAligned) continue;

    const horizontalScore = caretRect.left < rect.left
      ? rect.left - caretRect.left
      : caretRect.left > rect.right
        ? caretRect.left - rect.right
        : 0;

    if (horizontalScore < bestScore) {
      bestScore = horizontalScore;
      bestMatch = word;
    }
  }

  if (!bestMatch) return null;
  return bestMatch.start + resolveCaretCharacterOffset(bestMatch, caretRect);
}

function getGoogleDocsCursorCaret(doc: Document): HTMLElement | null {
  const cursor = doc.querySelector<HTMLElement>(GOOGLE_DOCS_CURSOR_SELECTOR);
  if (!cursor) return null;
  return cursor.querySelector<HTMLElement>(GOOGLE_DOCS_CURSOR_CARET_SELECTOR);
}

function resolveCaretCharacterOffset(
  word: ReturnType<typeof buildGoogleDocsWordEntries>[number],
  caretRect: DOMRect,
): number {
  const relativeLeft = Math.max(0, caretRect.left - word.rect.left);
  if (relativeLeft <= 0) return 0;

  const totalWidth = measureGoogleDocsTextWidth(word.text, word.element);
  const scale = totalWidth > 0 ? word.rect.width / totalWidth : 1;
  let width = 0;

  for (let index = 0; index < word.text.length; index += 1) {
    width += measureGoogleDocsTextWidth(word.text[index], word.element) * scale;
    if (width >= relativeLeft) return index + 1;
  }

  return word.text.length;
}

function hasGoogleDocsSelection(doc: Document): boolean {
  return Boolean(doc.querySelector(GOOGLE_DOCS_SELECTION_SELECTOR));
}

function focusGoogleDocsTarget(target: GoogleDocsInputTarget): void {
  if ('body' in target && target.body) {
    target.body.focus?.();
  } else if (target instanceof HTMLElement) {
    target.focus?.();
  }

  dispatchPrintableCharacter(target, '?');
  pressSpecialKey(target, 'Backspace', 8);
}

function selectAllGoogleDocsText(target: GoogleDocsInputTarget): void {
  const isMac = /\bMac\b/i.test(navigator.platform);
  pressSpecialKey(target, 'a', 65, isMac ? { metaKey: true } : { ctrlKey: true });
}

function moveCaretByDelta(target: GoogleDocsInputTarget, delta: number): void {
  if (delta === 0) return;

  const key = delta > 0 ? 'ArrowRight' : 'ArrowLeft';
  const keyCode = delta > 0 ? 39 : 37;

  for (let index = 0; index < Math.abs(delta); index += 1) {
    pressSpecialKey(target, key, keyCode);
  }
}

function extendSelection(target: GoogleDocsInputTarget, length: number): void {
  for (let index = 0; index < length; index += 1) {
    pressSpecialKey(target, 'ArrowRight', 39, { shiftKey: true });
  }
}

function typeGoogleDocsText(target: GoogleDocsInputTarget, text: string): void {
  for (const character of text) {
    if (character === '\n') {
      pressSpecialKey(target, 'Enter', 13);
      continue;
    }

    dispatchPrintableCharacter(target, character);
  }
}

function dispatchPrintableCharacter(target: GoogleDocsInputTarget, character: string): void {
  const codePoint = character.codePointAt(0) ?? 0;
  target.dispatchEvent(new KeyboardEvent('keypress', {
    key: character,
    code: getPrintableCode(character),
    keyCode: codePoint,
    charCode: codePoint,
    which: codePoint,
    bubbles: true,
    cancelable: true,
  }));
}

function getPrintableCode(character: string): string {
  if (character === ' ') return 'Space';
  if (/^[A-Za-z]$/.test(character)) return `Key${character.toUpperCase()}`;
  return 'Unidentified';
}

function pressSpecialKey(
  target: GoogleDocsInputTarget,
  key: string,
  keyCode: number,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    code: key.length === 1 ? getPrintableCode(key) : key,
    keyCode,
    which: keyCode,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  }));
}

async function waitForExpectedText(root: HTMLElement, expectedText: string): Promise<boolean> {
  const deadline = Date.now() + APPLY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (extractGoogleDocsRenderedText(root) === expectedText) return true;
    await waitForFrame();
  }

  return extractGoogleDocsRenderedText(root) === expectedText;
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    const raf = window.requestAnimationFrame
      ?? ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    raf(() => resolve());
  });
}
