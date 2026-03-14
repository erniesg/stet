import { extractText } from './text-extractor.js';

export type HistoryEditableKind = 'textarea' | 'contenteditable';

export interface EditableTarget {
  element: HTMLElement;
  kind: HistoryEditableKind;
  fieldKey: string;
  storageKey: string;
  descriptor: string;
  label: string;
  url: string;
  read(): string;
  write(text: string): void;
}

export const CONTENTEDITABLE_SELECTOR = '[contenteditable]';
const HISTORY_STORAGE_PREFIX = 'stet:history:';

export function isAnnotatableEditable(element: HTMLElement): boolean {
  return isTopLevelContentEditable(element);
}

export function findAnnotatableEditable(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof HTMLElement)) return null;
  const editable = findTopLevelContentEditable(start);
  return editable && isAnnotatableEditable(editable) ? editable : null;
}

export function findHistoryEditable(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof HTMLElement)) return null;

  const directTextarea = start instanceof HTMLTextAreaElement ? start : null;
  if (directTextarea && isHistoryTextarea(directTextarea)) return directTextarea;

  const textarea = start.closest('textarea');
  if (textarea instanceof HTMLTextAreaElement && isHistoryTextarea(textarea)) {
    return textarea;
  }

  const editable = findTopLevelContentEditable(start);
  return editable && isTopLevelContentEditable(editable) ? editable : null;
}

export function discoverAnnotatableEditables(root: ParentNode = document): HTMLElement[] {
  return discoverEditables(root).filter(isAnnotatableEditable);
}

export function discoverHistoryEditables(root: ParentNode = document): HTMLElement[] {
  return discoverEditables(root).filter((element) => {
    if (element instanceof HTMLTextAreaElement) return isHistoryTextarea(element);
    return isTopLevelContentEditable(element);
  });
}

export function getEditableTarget(element: HTMLElement): EditableTarget | null {
  if (!(element instanceof HTMLElement)) return null;

  const kind = getEditableKind(element);
  if (!kind) return null;

  const descriptor = buildEditableDescriptor(element);
  const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const fieldKey = hashString(`${url}::${descriptor}`);

  return {
    element,
    kind,
    fieldKey,
    storageKey: `${HISTORY_STORAGE_PREFIX}${fieldKey}`,
    descriptor,
    label: getEditableLabel(element),
    url,
    read: () => extractText(element),
    write: (text: string) => replaceEditableText(element, text),
  };
}

export function replaceEditableText(element: HTMLElement, text: string): void {
  const doc = element.ownerDocument;

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (valueDescriptor?.set) {
      valueDescriptor.set.call(element, text);
    } else {
      element.value = text;
    }
    dispatchEditableEvents(element);
    return;
  }

  element.focus();

  const selection = doc.getSelection();
  if (selection) {
    const range = doc.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  let applied = false;
  if (typeof doc.execCommand === 'function') {
    try {
      applied = doc.execCommand('insertText', false, text);
    } catch {
      applied = false;
    }
  }

  if (!applied) {
    element.innerText = text;
  }

  dispatchEditableEvents(element);
}

export function replaceEditableRange(
  element: HTMLElement,
  start: number,
  end: number,
  replacement: string,
): boolean {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const current = element.value;
    const next = `${current.slice(0, start)}${replacement}${current.slice(end)}`;
    replaceEditableText(element, next);
    return true;
  }

  const textNodes = buildContentEditableNodeMap(element);
  if (textNodes.length === 0) return false;

  try {
    const doc = element.ownerDocument;
    const startPoint = resolveOffsetToDomPoint(start, textNodes, element);
    const endPoint = resolveOffsetToDomPoint(end, textNodes, element);
    const selection = doc.getSelection();

    element.focus();

    if (startPoint.node === endPoint.node && startPoint.node instanceof Text) {
      const node = startPoint.node;
      const current = node.textContent || '';
      node.textContent =
        `${current.slice(0, startPoint.offset)}${replacement}${current.slice(endPoint.offset)}`;

      if (selection) {
        const caretRange = doc.createRange();
        const nextOffset = Math.min(node.textContent?.length ?? 0, startPoint.offset + replacement.length);
        caretRange.setStart(node, nextOffset);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }

      return true;
    }

    if (selection) {
      const selectionRange = doc.createRange();
      selectionRange.setStart(startPoint.node, startPoint.offset);
      selectionRange.setEnd(endPoint.node, endPoint.offset);
      selection.removeAllRanges();
      selection.addRange(selectionRange);

      let applied = false;
      if (typeof doc.execCommand === 'function') {
        try {
          applied = doc.execCommand('insertText', false, replacement);
        } catch {
          applied = false;
        }
      }

      if (applied) return true;
    }

    const range = doc.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    range.deleteContents();

    if (replacement.length > 0) {
      const textNode = doc.createTextNode(replacement);
      range.insertNode(textNode);

      if (selection) {
        const caretRange = doc.createRange();
        caretRange.setStart(textNode, textNode.textContent?.length ?? 0);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function notifyEditableChanged(element: HTMLElement): void {
  dispatchEditableEvents(element);
}

function dispatchEditableEvents(element: HTMLElement) {
  try {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertReplacementText',
      data: null,
    }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function buildContentEditableNodeMap(
  element: HTMLElement,
): { node: Text; start: number; end: number }[] {
  const innerText = element.innerText || '';
  const entries: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  let searchFrom = 0;
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const content = node.textContent || '';
    if (!content) continue;
    if (!content.trim() && !content.includes('\u00a0')) continue;

    const idx = innerText.indexOf(content, searchFrom);
    if (idx >= 0) {
      entries.push({ node, start: idx, end: idx + content.length });
      searchFrom = idx + content.length;
    }
  }

  return entries;
}

function resolveOffsetToDomPoint(
  offset: number,
  textNodes: { node: Text; start: number; end: number }[],
  element: HTMLElement,
): { node: Node; offset: number } {
  if (textNodes.length === 0) {
    return { node: element, offset: 0 };
  }

  const clampedOffset = Math.max(0, offset);
  for (const entry of textNodes) {
    if (clampedOffset <= entry.end) {
      return {
        node: entry.node,
        offset: Math.max(
          0,
          Math.min(entry.node.textContent?.length ?? 0, clampedOffset - entry.start),
        ),
      };
    }
  }

  const last = textNodes[textNodes.length - 1];
  return {
    node: last.node,
    offset: last.node.textContent?.length ?? 0,
  };
}

function discoverEditables(root: ParentNode): HTMLElement[] {
  const discovered = new Set<HTMLElement>();

  if (root instanceof HTMLElement && getEditableKind(root)) {
    discovered.add(root);
  }

  if (!('querySelectorAll' in root)) return [...discovered];

  const nodes = root.querySelectorAll<HTMLElement>(`textarea, ${CONTENTEDITABLE_SELECTOR}`);
  nodes.forEach((node) => {
    if (getEditableKind(node)) discovered.add(node);
  });

  return [...discovered];
}

function getEditableKind(element: HTMLElement): HistoryEditableKind | null {
  if (element instanceof HTMLTextAreaElement && isHistoryTextarea(element)) return 'textarea';
  if (isTopLevelContentEditable(element)) return 'contenteditable';
  return null;
}

function isHistoryTextarea(element: HTMLTextAreaElement): boolean {
  if (element.disabled || element.readOnly) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  const rect = element.getBoundingClientRect();
  return rect.width >= 80 && rect.height >= 28;
}

function isTopLevelContentEditable(element: HTMLElement): boolean {
  if (!element.isContentEditable) return false;
  if (element.getAttribute('contenteditable') === 'false') return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  return !element.parentElement?.isContentEditable;
}

function findTopLevelContentEditable(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start;
  let candidate: HTMLElement | null = null;

  while (node) {
    if (node.isContentEditable && node.getAttribute('contenteditable') !== 'false') {
      candidate = node;
    }
    node = node.parentElement;
  }

  return candidate && isTopLevelContentEditable(candidate) ? candidate : null;
}

function buildEditableDescriptor(element: HTMLElement): string {
  const segments: string[] = [];
  let node: HTMLElement | null = element;

  while (node && node !== document.body && segments.length < 5) {
    const segment = buildDescriptorSegment(node);
    segments.unshift(segment);
    if (node.id) break;
    node = node.parentElement;
  }

  return segments.join(' > ');
}

function buildDescriptorSegment(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${sanitizeSegment(element.id)}`;

  const namedAttribute = [
    ['name', element.getAttribute('name')],
    ['aria-label', element.getAttribute('aria-label')],
    ['placeholder', element.getAttribute('placeholder')],
    ['data-testid', element.getAttribute('data-testid')],
    ['role', element.getAttribute('role')],
  ].find(([, value]) => Boolean(value?.trim()));

  if (namedAttribute) {
    return `${tag}[${namedAttribute[0]}="${sanitizeSegment(namedAttribute[1]!.trim())}"]`;
  }

  const parent = element.parentElement;
  if (!parent) return tag;

  const siblings = [...parent.children].filter((child) => child.tagName === element.tagName);
  const index = siblings.indexOf(element) + 1;
  return `${tag}:nth-of-type(${index})`;
}

function getEditableLabel(element: HTMLElement): string {
  const labelText = getAssociatedLabelText(element);
  if (labelText) return labelText;

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  const placeholder = element.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;

  const name = element.getAttribute('name')?.trim();
  if (name) return name;

  return element.id ? `#${element.id}` : buildDescriptorSegment(element);
}

function getAssociatedLabelText(element: HTMLElement): string | null {
  if (!element.id) return null;

  const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
  const text = label?.textContent?.trim();
  return text ? collapseWhitespace(text) : null;
}

function sanitizeSegment(value: string): string {
  return collapseWhitespace(value).slice(0, 60);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fp-${(hash >>> 0).toString(16)}`;
}
