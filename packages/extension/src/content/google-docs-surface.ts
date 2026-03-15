const GOOGLE_DOCS_ROOT_SELECTOR = '.kix-appview-editor, #docs-editor, #docs-editor-container';
const GOOGLE_DOCS_PAGE_SELECTOR = '.kix-page-paginated, .kix-page, .docs-page';
const GOOGLE_DOCS_LINE_SELECTOR = '.kix-lineview, .kix-paragraphrenderer';
const GOOGLE_DOCS_LINE_TEXT_SELECTOR = '.kix-lineview-text-block';
const GOOGLE_DOCS_WORD_SELECTOR = '.kix-wordhtmlgenerator-word-node';
const GOOGLE_DOCS_TEXT_RECT_SELECTOR = 'rect[aria-label]';
const GOOGLE_DOCS_EVENT_TARGET_SELECTOR = 'iframe.docs-texteventtarget-iframe, .docs-texteventtarget-iframe';
const GOOGLE_DOCS_EVENT_TARGET_TEXT_SELECTOR = '[contenteditable="true"], [role="textbox"], textarea';

export interface GoogleDocsWordEntry {
  element: Element;
  text: string;
  start: number;
  end: number;
  rect: DOMRect;
}

interface GoogleDocsTextFragment {
  element: SVGRectElement;
  text: string;
  rect: DOMRect;
}

export function isGoogleDocsHost(root: ParentNode | Document = document): boolean {
  const doc = toDocument(root);
  return doc.defaultView?.location.hostname === 'docs.google.com';
}

export function isGoogleDocsSurfaceRoot(element: HTMLElement): boolean {
  return element.matches(GOOGLE_DOCS_ROOT_SELECTOR);
}

export function findGoogleDocsSurfaceRoot(root: ParentNode | Document = document): HTMLElement | null {
  if (!isGoogleDocsHost(root)) return null;

  const doc = toDocument(root);
  const scopedRoot = root instanceof Document ? root : root;
  const candidates = new Set<HTMLElement>();

  if (scopedRoot instanceof HTMLElement && scopedRoot.matches(GOOGLE_DOCS_ROOT_SELECTOR)) {
    candidates.add(scopedRoot);
  }

  if ('querySelectorAll' in scopedRoot) {
    for (const candidate of scopedRoot.querySelectorAll<HTMLElement>(GOOGLE_DOCS_ROOT_SELECTOR)) {
      candidates.add(candidate);
    }
  }

  let bestMatch: HTMLElement | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreGoogleDocsSurfaceRoot(candidate);
    if (score <= bestScore) continue;
    bestMatch = candidate;
    bestScore = score;
  }

  if (bestMatch) return bestMatch;

  const docRoot = doc.querySelector<HTMLElement>(GOOGLE_DOCS_ROOT_SELECTOR);
  return docRoot ?? null;
}

export function extractGoogleDocsRenderedText(root: HTMLElement): string {
  const lineBlocks = getVisibleLineBlocks(root);
  if (lineBlocks.length > 0) {
    return lineBlocks
      .map((block) => normalizeGoogleDocsText(block.textContent || ''))
      .map((value) => value.replace(/\s+$/g, ''))
      .filter((value) => value.trim().length > 0)
      .join('\n');
  }

  const wordNodes = getVisibleWordNodes(root);
  if (wordNodes.length > 0) {
    return wordNodes
      .map((word) => normalizeGoogleDocsText(word.textContent || ''))
      .join('')
      .trim();
  }

  const textRectSurface = buildTextRectSurface(root);
  if (textRectSurface.text) {
    return textRectSurface.text;
  }

  return extractGoogleDocsEventTargetText(root.ownerDocument ?? document);
}

export function hasVisibleGoogleDocsSurfaceContent(root: HTMLElement): boolean {
  return extractGoogleDocsRenderedText(root).trim().length > 0;
}

export function scoreGoogleDocsSurfaceRoot(root: HTMLElement): number {
  const text = extractGoogleDocsRenderedText(root);
  if (!text) return 0;

  const rect = root.getBoundingClientRect();
  const area = Math.max(0, rect.width * rect.height);
  const pageCount = root.querySelectorAll(GOOGLE_DOCS_PAGE_SELECTOR).length;
  const lineCount = root.querySelectorAll(GOOGLE_DOCS_LINE_TEXT_SELECTOR).length;
  const wordCount = root.querySelectorAll(GOOGLE_DOCS_WORD_SELECTOR).length;
  const textRectCount = getVisibleTextRects(root).length;

  let score = text.length;
  score += area;
  score += pageCount * 1_000_000;
  score += lineCount * 20_000;
  score += wordCount * 1_000;
  score += textRectCount * 5_000;

  if (root.matches('.kix-appview-editor')) score += 5_000_000;
  else if (root.matches('#docs-editor')) score += 2_500_000;
  else if (root.matches('#docs-editor-container')) score += 1_000_000;

  return score;
}

export function hasGoogleDocsCoordinateSurface(
  root: HTMLElement,
  fullText = extractGoogleDocsRenderedText(root),
): boolean {
  return buildGoogleDocsWordEntries(root, fullText).length > 0;
}

export function collectGoogleDocsIssueRects(
  root: HTMLElement,
  start: number,
  end: number,
  fullText = extractGoogleDocsRenderedText(root),
): DOMRect[] {
  if (end <= start) return [];

  return buildGoogleDocsWordEntries(root, fullText)
    .filter((entry) => entry.end > start && entry.start < end)
    .map((entry) => sliceGoogleDocsWordRect(entry, start, end))
    .filter((rect): rect is DOMRect => rect !== null && rect.width > 0 && rect.height > 0);
}

export function buildGoogleDocsWordEntries(
  root: HTMLElement,
  fullText = extractGoogleDocsRenderedText(root),
): GoogleDocsWordEntry[] {
  const lineBlocks = getVisibleLineBlocks(root);
  if (lineBlocks.length > 0) {
    const entries = buildWordEntriesFromLineBlocks(lineBlocks, fullText);
    if (entries.length > 0) return entries;
  }

  const entries: GoogleDocsWordEntry[] = [];
  let searchFrom = 0;

  for (const element of getVisibleWordNodes(root)) {
    const text = normalizeGoogleDocsText(element.textContent || '');
    if (!text) continue;

    let index = fullText.indexOf(text, searchFrom);
    if (index === -1) index = fullText.indexOf(text);
    if (index === -1) continue;

    entries.push({
      element,
      text,
      start: index,
      end: index + text.length,
      rect: element.getBoundingClientRect(),
    });
    searchFrom = index + text.length;
  }

  if (entries.length > 0) return entries;

  const textRectSurface = buildTextRectSurface(root);
  if (textRectSurface.text && textRectSurface.entries.length > 0) {
    if (fullText === textRectSurface.text) return textRectSurface.entries;

    return remapGoogleDocsEntriesToText(textRectSurface.entries, fullText);
  }

  return entries;
}

export function measureGoogleDocsTextWidth(text: string, source: Element): number {
  if (!text) return 0;

  const probe = document.createElement('span');
  probe.textContent = text;
  probe.style.position = 'absolute';
  probe.style.left = '-99999px';
  probe.style.top = '-99999px';
  probe.style.whiteSpace = 'pre';

  const computed = window.getComputedStyle(source);
  probe.style.font = computed.font;
  probe.style.fontFamily = computed.fontFamily;
  probe.style.fontSize = computed.fontSize;
  probe.style.fontWeight = computed.fontWeight;
  probe.style.fontStyle = computed.fontStyle;
  probe.style.letterSpacing = computed.letterSpacing;

  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

export function normalizeGoogleDocsText(value: string): string {
  return value
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ');
}

function buildWordEntriesFromLineBlocks(
  lineBlocks: HTMLElement[],
  fullText: string,
): GoogleDocsWordEntry[] {
  const entries: GoogleDocsWordEntry[] = [];
  let searchFrom = 0;

  for (const lineBlock of lineBlocks) {
    const lineText = normalizeGoogleDocsText(lineBlock.textContent || '').replace(/\s+$/g, '');
    if (!lineText) continue;

    let lineStart = fullText.indexOf(lineText, searchFrom);
    if (lineStart === -1) lineStart = fullText.indexOf(lineText);
    if (lineStart === -1) continue;

    const container = lineBlock.closest<HTMLElement>(GOOGLE_DOCS_LINE_SELECTOR)
      ?? lineBlock.parentElement
      ?? lineBlock;
    const words = getVisibleWordNodes(container);
    let lineSearchFrom = 0;

    for (const element of words) {
      const text = normalizeGoogleDocsText(element.textContent || '');
      if (!text) continue;

      let localIndex = lineText.indexOf(text, lineSearchFrom);
      if (localIndex === -1) localIndex = lineText.indexOf(text);
      if (localIndex === -1) continue;

      entries.push({
        element,
        text,
        start: lineStart + localIndex,
        end: lineStart + localIndex + text.length,
        rect: element.getBoundingClientRect(),
      });
      lineSearchFrom = localIndex + text.length;
    }

    searchFrom = lineStart + lineText.length;
  }

  return entries;
}

function sliceGoogleDocsWordRect(
  entry: GoogleDocsWordEntry,
  start: number,
  end: number,
): DOMRect | null {
  const sliceStart = Math.max(start, entry.start) - entry.start;
  const sliceEnd = Math.min(end, entry.end) - entry.start;
  if (sliceEnd <= sliceStart) return null;

  if (sliceStart === 0 && sliceEnd === entry.text.length) {
    return entry.rect;
  }

  const measuredWidth = measureGoogleDocsTextWidth(entry.text, entry.element);
  const scale = measuredWidth > 0 ? entry.rect.width / measuredWidth : 1;
  const leftWidth = measureGoogleDocsTextWidth(entry.text.slice(0, sliceStart), entry.element) * scale;
  const selectedWidth = measureGoogleDocsTextWidth(
    entry.text.slice(sliceStart, sliceEnd),
    entry.element,
  ) * scale;

  const left = entry.rect.left + leftWidth;
  const width = Math.max(2, selectedWidth || (entry.rect.width / Math.max(1, entry.text.length)));

  return createDomRect(left, entry.rect.top, width, entry.rect.height);
}

function createDomRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function extractGoogleDocsEventTargetText(doc: Document): string {
  const target = doc.querySelector<HTMLElement | HTMLIFrameElement>(GOOGLE_DOCS_EVENT_TARGET_SELECTOR);
  if (!target) return '';

  if (target instanceof HTMLIFrameElement) {
    const frameDoc = target.contentDocument;
    if (!frameDoc) return '';
    return readEventTargetText(frameDoc);
  }

  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target.getAttribute('contenteditable') === 'true'
  ) {
    return normalizeGoogleDocsText(readElementText(target));
  }

  const nested = target.querySelector<HTMLElement>(GOOGLE_DOCS_EVENT_TARGET_TEXT_SELECTOR);
  return nested ? normalizeGoogleDocsText(readElementText(nested)) : '';
}

function readEventTargetText(doc: Document): string {
  const node = doc.querySelector<HTMLElement>(GOOGLE_DOCS_EVENT_TARGET_TEXT_SELECTOR);
  return node ? normalizeGoogleDocsText(readElementText(node)) : '';
}

function readElementText(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  return element.innerText || element.textContent || '';
}

function getVisibleLineBlocks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(GOOGLE_DOCS_LINE_TEXT_SELECTOR)]
    .filter((element) => isVisibleGoogleDocsElement(element));
}

function getVisibleWordNodes(root: ParentNode): HTMLElement[] {
  if (!('querySelectorAll' in root)) return [];
  return [...root.querySelectorAll<HTMLElement>(GOOGLE_DOCS_WORD_SELECTOR)]
    .filter((element) => isVisibleGoogleDocsElement(element, false));
}

function getVisibleTextRects(root: ParentNode): SVGRectElement[] {
  if (!('querySelectorAll' in root)) return [];
  return [...root.querySelectorAll<SVGRectElement>(GOOGLE_DOCS_TEXT_RECT_SELECTOR)]
    .filter((element) => {
      const text = normalizeGoogleDocsText(element.getAttribute('aria-label') || '');
      if (!text.trim()) return false;
      return isVisibleGoogleDocsElement(element, false);
    });
}

function buildTextRectSurface(root: ParentNode): { text: string; entries: GoogleDocsWordEntry[] } {
  const fragments = getVisibleTextRects(root)
    .map((element) => ({
      element,
      text: normalizeGoogleDocsText(element.getAttribute('aria-label') || ''),
      rect: element.getBoundingClientRect(),
    }))
    .filter((fragment) => fragment.text.trim().length > 0);

  if (fragments.length === 0) {
    return { text: '', entries: [] };
  }

  fragments.sort((left, right) => compareGoogleDocsFragments(left, right));

  const lines: GoogleDocsTextFragment[][] = [];
  for (const fragment of fragments) {
    const currentLine = lines.at(-1);
    if (!currentLine || Math.abs(currentLine[0].rect.top - fragment.rect.top) > 5) {
      lines.push([fragment]);
      continue;
    }

    currentLine.push(fragment);
  }

  const entries: GoogleDocsWordEntry[] = [];
  let fullText = '';

  lines.forEach((line, lineIndex) => {
    line.sort((left, right) => left.rect.left - right.rect.left);

    if (lineIndex > 0) fullText += '\n';

    let lineText = '';
    for (const fragment of line) {
      const separator = getGoogleDocsFragmentSeparator(lineText, fragment.text);
      const start = fullText.length + lineText.length + separator.length;
      lineText += `${separator}${fragment.text}`;
      entries.push({
        element: fragment.element,
        text: fragment.text,
        start,
        end: start + fragment.text.length,
        rect: fragment.rect,
      });
    }

    fullText += lineText;
  });

  return { text: fullText, entries };
}

function remapGoogleDocsEntriesToText(entries: GoogleDocsWordEntry[], fullText: string): GoogleDocsWordEntry[] {
  const remapped: GoogleDocsWordEntry[] = [];
  let searchFrom = 0;

  for (const entry of entries) {
    let index = fullText.indexOf(entry.text, searchFrom);
    if (index === -1) index = fullText.indexOf(entry.text);
    if (index === -1) continue;

    remapped.push({
      ...entry,
      start: index,
      end: index + entry.text.length,
    });
    searchFrom = index + entry.text.length;
  }

  return remapped;
}

function compareGoogleDocsFragments(left: GoogleDocsTextFragment, right: GoogleDocsTextFragment): number {
  if (Math.abs(left.rect.top - right.rect.top) > 5) {
    return left.rect.top - right.rect.top;
  }

  if (Math.abs(left.rect.left - right.rect.left) > 1) {
    return left.rect.left - right.rect.left;
  }

  return left.text.localeCompare(right.text);
}

function getGoogleDocsFragmentSeparator(currentLine: string, nextText: string): string {
  if (!currentLine) return '';

  if (/\s$/.test(currentLine) || /^\s/.test(nextText)) return '';
  if (/^[,.;:!?%)\]}]/.test(nextText)) return '';
  if (/[(\[{/"'`-]$/.test(currentLine)) return '';

  return ' ';
}

function isVisibleGoogleDocsElement(element: Element, requireSize = true): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  const rect = element.getBoundingClientRect();
  if (!requireSize) return rect.width > 0 || rect.height > 0;
  return rect.width >= 1 && rect.height >= 1;
}

function toDocument(root: ParentNode | Document): Document {
  if (root instanceof Document) return root;
  return root.ownerDocument ?? document;
}
