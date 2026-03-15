import { extractText } from './text-extractor.js';
import type {
  EditableHistoryIdentity,
  EditableHistoryIdentitySignals,
} from './version-history-core.js';
import { getTextareaForMirror } from './textarea-mirror.js';

export type HistoryEditableKind = 'textarea' | 'contenteditable';

export interface EditableIdentitySeed {
  url: string;
  descriptor: string;
  label: string;
  id?: string | null;
  name?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  dataTestId?: string | null;
  role?: string | null;
  containerHint?: string | null;
}

export interface EditableTarget {
  element: HTMLElement;
  kind: HistoryEditableKind;
  fieldKey: string;
  storageKey: string;
  descriptor: string;
  label: string;
  url: string;
  identity: EditableHistoryIdentity;
  read(): string;
  write(text: string): void;
}

export const CONTENTEDITABLE_SELECTOR = '[contenteditable]';
const HISTORY_STORAGE_PREFIX = 'stet:history:';

interface HostEditableAdapter {
  read(): string;
  write(text: string): void;
  supportsRangeReplace: boolean;
}

export type AnnotationSupportMode = 'inline' | 'overlay' | 'panel';

export interface AnnotationSupport {
  mode: AnnotationSupportMode;
  reason: string;
}

interface BTEditorHostApi {
  contentEl?: HTMLElement | null;
  getText?: () => string;
  setText?: (text: string) => void;
}

declare global {
  interface Window {
    btEditor?: BTEditorHostApi;
  }
}

export function isAnnotatableEditable(element: HTMLElement): boolean {
  return isTopLevelContentEditable(element);
}

export function getAnnotationSupport(element: HTMLElement): AnnotationSupport {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return {
      mode: 'panel',
      reason: 'plain-text-control',
    };
  }

  if (!hasEnabledContentEditable(element)) {
    return {
      mode: 'panel',
      reason: 'not-contenteditable',
    };
  }

  // Always use inline stet-mark annotations for contenteditable elements.
  // Marks may be destroyed by host editor re-renders (e.g. BTEditor
  // _renderHighlights) but the checker will recreate them on the next cycle.
  return { mode: 'inline', reason: 'contenteditable' };
}

export function supportsInlineAnnotationMarkup(element: HTMLElement): boolean {
  return getAnnotationSupport(element).mode === 'inline';
}

export function findAnnotatableEditable(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof HTMLElement)) return null;
  const editable = findTopLevelContentEditable(start);
  return editable && isAnnotatableEditable(editable) ? editable : null;
}

export function findHistoryEditable(start: EventTarget | null): HTMLElement | null {
  const startElement = toHistoryElement(start);
  if (!startElement) return null;

  return (
    findDirectHistoryEditable(startElement) ??
    findSelectionHistoryEditable(startElement) ??
    findHistoryEditableInElementShell(startElement) ??
    findHistoryEditableInAncestorShells(startElement)
  );
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

  // If the element is a textarea mirror, build identity from the original
  // textarea (for stable field keys) but read/write through the mirror.
  const mirroredTextarea = getTextareaForMirror(element);
  if (mirroredTextarea) {
    return buildMirrorEditableTarget(element, mirroredTextarea);
  }

  const kind = getEditableKind(element);
  if (!kind) return null;

  const descriptor = buildEditableDescriptor(element);
  const label = getEditableLabel(element);
  const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const identity = deriveEditableIdentity({
    url,
    descriptor,
    label,
    id: element.id || null,
    name: element.getAttribute('name'),
    ariaLabel: element.getAttribute('aria-label'),
    placeholder: element.getAttribute('placeholder'),
    dataTestId: element.getAttribute('data-testid'),
    role: element.getAttribute('role'),
    containerHint: buildContainerHint(element),
  });

  return {
    element,
    kind,
    fieldKey: identity.fieldKey,
    storageKey: `${HISTORY_STORAGE_PREFIX}${identity.fieldKey}`,
    descriptor,
    label,
    url,
    identity: {
      descriptorKey: identity.descriptorKey,
      stableKey: identity.stableKey,
      source: identity.source,
      signals: identity.signals,
    },
    read: () => readEditableText(element),
    write: (text: string) => getHostEditableAdapter(element)?.write(text) ?? replaceEditableText(element, text),
  };
}

function buildMirrorEditableTarget(
  mirror: HTMLElement,
  textarea: HTMLTextAreaElement,
): EditableTarget {
  // Build identity from the original textarea for stable field keys
  const descriptor = buildEditableDescriptor(textarea);
  const label = getEditableLabel(textarea);
  const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const identity = deriveEditableIdentity({
    url,
    descriptor,
    label,
    id: textarea.id || null,
    name: textarea.getAttribute('name'),
    ariaLabel: textarea.getAttribute('aria-label'),
    placeholder: textarea.getAttribute('placeholder'),
    dataTestId: textarea.getAttribute('data-testid'),
    role: textarea.getAttribute('role'),
    containerHint: buildContainerHint(textarea),
  });

  return {
    element: mirror,
    kind: 'textarea', // Keep 'textarea' kind for history label purposes
    fieldKey: identity.fieldKey,
    storageKey: `${HISTORY_STORAGE_PREFIX}${identity.fieldKey}`,
    descriptor,
    label,
    url,
    identity: {
      descriptorKey: identity.descriptorKey,
      stableKey: identity.stableKey,
      source: identity.source,
      signals: identity.signals,
    },
    // Read from the mirror's text content (authoritative while user is typing)
    read: () => mirror.textContent || '',
    // Write to both mirror and textarea
    write: (text: string) => {
      mirror.textContent = text;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (valueSetter) {
        valueSetter.call(textarea, text);
      } else {
        textarea.value = text;
      }
      dispatchEditableEvents(textarea);
    },
  };
}

export function deriveEditableIdentity(seed: EditableIdentitySeed): EditableHistoryIdentity & {
  fieldKey: string;
} {
  const signals = normalizeIdentitySignals(seed);
  const stableKeyInput = hasStrongIdentitySignal(signals)
    ? buildStableIdentitySignature(signals)
    : '';
  const stableKey = stableKeyInput ? hashString(`${seed.url}::${stableKeyInput}`) : null;
  const descriptorKey = hashString(`${seed.url}::${seed.descriptor}`);

  return {
    fieldKey: stableKey ?? descriptorKey,
    descriptorKey,
    stableKey,
    source: stableKey ? 'stable' : 'descriptor',
    signals,
  };
}

export function replaceEditableText(element: HTMLElement, text: string): void {
  const hostAdapter = getHostEditableAdapter(element);
  if (hostAdapter) {
    hostAdapter.write(text);
    return;
  }

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
  const hostAdapter = getHostEditableAdapter(element);
  if (hostAdapter && !hostAdapter.supportsRangeReplace) return false;

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

export function readEditableText(element: HTMLElement): string {
  return getHostEditableAdapter(element)?.read() ?? extractText(element);
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

function getHostEditableAdapter(element: HTMLElement): HostEditableAdapter | null {
  const btEditor = window.btEditor;
  if (!btEditor || typeof btEditor !== 'object') return null;
  if (btEditor.contentEl !== element) return null;
  if (typeof btEditor.getText !== 'function' || typeof btEditor.setText !== 'function') return null;

  return {
    read: () => btEditor.getText!(),
    write: (text: string) => {
      btEditor.setText!(text);
      dispatchEditableEvents(element);
    },
    supportsRangeReplace: false,
  };
}

const INLINE_ANNOTATION_ALLOWED_TAGS = new Set([
  'A',
  'B',
  'BLOCKQUOTE',
  'BR',
  'CODE',
  'DIV',
  'EM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'I',
  'LI',
  'OL',
  'P',
  'PRE',
  'S',
  'SMALL',
  'SPAN',
  'STET-MARK',
  'STRONG',
  'SUB',
  'SUP',
  'U',
  'UL',
]);

const HOST_MANAGED_EDITOR_PATTERN = /\b(fig-ref|bt-editor|prosemirror|ql-editor|public-drafteditor|drafteditor|lexical|slate|ck-content|mce-content-body|tox-edit-area)\b/i;
const HOST_MANAGED_ATTRIBUTE_PATTERN = /^(data-offset-key|data-lexical|data-slate|data-block|data-editor)/i;

function hasSafeInlineAnnotationMarkup(element: HTMLElement): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
      if (node === element) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.tagName === 'STET-MARK' || node.tagName === 'BR') continue;
    if (hasEnabledContentEditable(node)) return false;
    if (isHostManagedNode(node)) return false;
    if (!INLINE_ANNOTATION_ALLOWED_TAGS.has(node.tagName)) return false;
  }

  return true;
}

function hasHostManagedEditorMarker(element: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  let depth = 0;

  while (node && depth < 3) {
    if (isHostManagedNode(node)) return true;
    node = node.parentElement;
    depth += 1;
  }

  return false;
}

function isHostManagedNode(element: HTMLElement): boolean {
  if (element.tagName.includes('-')) return true;
  if (element.getAttribute('contenteditable') === 'false') return true;

  const markerText = [
    typeof element.className === 'string' ? element.className : '',
    element.id,
    element.getAttribute('data-testid'),
    element.getAttribute('data-qa'),
    element.getAttribute('aria-label'),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');

  if (HOST_MANAGED_EDITOR_PATTERN.test(markerText)) return true;

  return [...element.attributes].some((attribute) => HOST_MANAGED_ATTRIBUTE_PATTERN.test(attribute.name));
}

function toHistoryElement(start: EventTarget | null): HTMLElement | null {
  if (start instanceof HTMLElement) return start;
  if (typeof Node !== 'undefined' && start instanceof Node) {
    return start.parentElement;
  }
  return null;
}

function findDirectHistoryEditable(start: HTMLElement): HTMLElement | null {
  const directTextarea = start instanceof HTMLTextAreaElement ? start : null;
  if (directTextarea && isHistoryTextarea(directTextarea)) return directTextarea;

  const textarea = start.closest('textarea');
  if (textarea instanceof HTMLTextAreaElement && isHistoryTextarea(textarea)) {
    return textarea;
  }

  const editable = findTopLevelContentEditable(start);
  return editable && isTopLevelContentEditable(editable) ? editable : null;
}

function findSelectionHistoryEditable(start: HTMLElement): HTMLElement | null {
  const selection = start.ownerDocument.getSelection?.();
  const anchorElement = toHistoryElement(selection?.anchorNode ?? null);
  if (!anchorElement) return null;
  if (!start.contains(anchorElement) && !anchorElement.contains(start)) return null;
  return findDirectHistoryEditable(anchorElement);
}

function findOwnedHistoryEditable(owner: HTMLElement): HTMLElement | null {
  const candidates = discoverHistoryEditables(owner).filter((candidate) => candidate !== owner);
  return candidates.length === 1 ? candidates[0] : null;
}

function findHistoryEditableInElementShell(start: HTMLElement): HTMLElement | null {
  if (!isLikelyEditorShell(start)) return null;
  return findOwnedHistoryEditable(start);
}

function findHistoryEditableInAncestorShells(start: HTMLElement): HTMLElement | null {
  let depth = 0;
  let node = start.parentElement;

  while (node && node !== document.body && depth < 4) {
    if (isLikelyEditorShell(node)) {
      const candidate = findOwnedHistoryEditable(node);
      if (candidate) return candidate;
    }

    node = node.parentElement;
    depth += 1;
  }

  return null;
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

  return isVisibleEditableRegion(element, { minWidth: 80, minHeight: 28 });
}

function isLikelyEditorShell(element: HTMLElement): boolean {
  const role = element.getAttribute('role')?.trim().toLowerCase();
  if (role === 'textbox') return true;

  const markers = [
    element.className,
    element.id,
    element.getAttribute('data-testid'),
    element.getAttribute('data-qa'),
    element.getAttribute('aria-label'),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  return /(editor|compose|composer|draft|editable|rich|field|headline|title|story|body)/.test(markers);
}

function isTopLevelContentEditable(element: HTMLElement): boolean {
  if (!hasEnabledContentEditable(element)) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (!isVisibleEditableRegion(element, { minWidth: 40, minHeight: 18 })) return false;
  return !element.parentElement || !hasEnabledContentEditable(element.parentElement);
}

function findTopLevelContentEditable(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start;
  let candidate: HTMLElement | null = null;

  while (node) {
    if (hasEnabledContentEditable(node)) {
      candidate = node;
    }
    node = node.parentElement;
  }

  return candidate && isTopLevelContentEditable(candidate) ? candidate : null;
}

function hasEnabledContentEditable(element: HTMLElement): boolean {
  const attribute = element.getAttribute('contenteditable');
  if (attribute === 'false') return false;
  if (attribute === '' || attribute === 'true' || attribute === 'plaintext-only') return true;
  return element.isContentEditable;
}

function isVisibleEditableRegion(
  element: HTMLElement,
  options: { minWidth: number; minHeight: number },
): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.pointerEvents === 'none') return false;

  const rect = element.getBoundingClientRect();
  return rect.width >= options.minWidth && rect.height >= options.minHeight;
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

  const label = document.querySelector(`label[for="${escapeCssValue(element.id)}"]`);
  const text = label?.textContent?.trim();
  return text ? collapseWhitespace(text) : null;
}

function escapeCssValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, '\\$&');
}

function sanitizeSegment(value: string): string {
  return collapseWhitespace(value).slice(0, 60);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeIdentitySignals(
  seed: EditableIdentitySeed,
): EditableHistoryIdentitySignals {
  return {
    label: sanitizeIdentityValue(seed.label),
    id: sanitizeIdentityValue(seed.id),
    name: sanitizeIdentityValue(seed.name),
    ariaLabel: sanitizeIdentityValue(seed.ariaLabel),
    placeholder: sanitizeIdentityValue(seed.placeholder),
    dataTestId: sanitizeIdentityValue(seed.dataTestId),
    role: sanitizeIdentityValue(seed.role),
    containerHint: sanitizeIdentityValue(seed.containerHint),
  };
}

function sanitizeIdentityValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = collapseWhitespace(value);
  return normalized ? normalized.slice(0, 80) : null;
}

function buildStableIdentitySignature(
  signals: EditableHistoryIdentitySignals,
): string {
  const semanticParts: Array<[string, string | null]> = [
    ['name', signals.name],
    ['aria', signals.ariaLabel],
    ['placeholder', signals.placeholder],
    ['testid', signals.dataTestId],
  ].filter((entry): entry is [string, string | null] => Boolean(entry[1]));

  const strongSemanticParts = semanticParts.filter(([key]) => key !== 'placeholder');

  const parts: Array<[string, string | null]> = [['label', signals.label]];

  if (semanticParts.length > 0) {
    parts.push(...semanticParts);
  }

  if (signals.containerHint) {
    parts.push(['container', signals.containerHint]);
  } else if (signals.id && strongSemanticParts.length === 0) {
    parts.push(['id', signals.id]);
  }

  if (semanticParts.length === 0) {
    parts.push(['role', signals.role]);
  }

  const normalizedParts = parts
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}:${value}`);

  return normalizedParts.join('|');
}

function hasStrongIdentitySignal(signals: EditableHistoryIdentitySignals): boolean {
  return Boolean(
    signals.id ||
    signals.name ||
    signals.ariaLabel ||
    signals.placeholder ||
    signals.dataTestId ||
    signals.containerHint,
  );
}

function buildContainerHint(element: HTMLElement): string | null {
  const segments: string[] = [];
  let node = element.parentElement;

  while (node && node !== document.body && segments.length < 3) {
    const stableSegment = getStableContainerSegment(node);
    if (stableSegment) segments.unshift(stableSegment);
    node = node.parentElement;
  }

  return segments.length > 0 ? segments.join(' > ') : null;
}

function getStableContainerSegment(element: HTMLElement): string | null {
  const tag = element.tagName.toLowerCase();
  const namedAttribute = [
    ['id', element.id],
    ['name', element.getAttribute('name')],
    ['data-testid', element.getAttribute('data-testid')],
    ['aria-label', element.getAttribute('aria-label')],
    ['role', element.getAttribute('role')],
  ].find(([, value]) => Boolean(value?.trim()));

  if (!namedAttribute) return null;
  return `${tag}[${namedAttribute[0]}="${sanitizeSegment(namedAttribute[1]!.trim())}"]`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fp-${(hash >>> 0).toString(16)}`;
}
