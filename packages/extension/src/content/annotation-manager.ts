/**
 * AnnotationManager — LanguageTool-style inline annotations.
 *
 * - Colored underlines by severity (red=error, orange=warning, blue=info)
 * - Click to open card popup with rule info, suggestion chips, ignore buttons
 * - Suggestion chips apply fixes via the checker replacement pipeline
 * - Ignore / Ignore all dismiss the issue
 */

import type { Issue } from 'stet';
import {
  collectGoogleDocsIssueRects,
  extractGoogleDocsRenderedText,
  getGoogleDocsViewportAnchorRect,
  isGoogleDocsSurfaceRoot,
} from './google-docs-surface.js';
import { resolveIssueRange } from './issue-range.js';
import { getElapsedMs, getNow, logHistoryEvent } from './version-history-debug.js';

const TAG = 'stet-mark';
const MAX_OVERLAY_MARKS = 50;
const CARD_VIEWPORT_MARGIN = 8;
const CARD_GAP = 6;
const OVERLAY_RECONCILE_DELAY_MS = 96;
const OVERLAY_FOLLOW_SCROLL_MS = 180;

/** Currently open popup card */
let activeCard: HTMLElement | null = null;
/** Currently active mark (the one whose card is open) */
let activeMark: HTMLElement | null = null;

interface AnnotationManagerOptions {
  onApplyIssue?: (issue: Issue) => boolean | Promise<boolean>;
  onIgnoreIssue?: (issue: Issue) => void;
  onIgnoreIssueFamily?: (fingerprint: string, issue: Issue) => void;
}

export type AnnotationRenderMode = 'inline' | 'overlay';

interface PopupViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

interface PopupCardSize {
  width: number;
  height: number;
}

interface PopupCardPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

const EXTENSION_UI_SELECTOR = '.stet-overlay-root, .stet-history-root, .stet-card, .stet-issues-root';

function clamp(value: number, min: number, max: number): number {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

function getPopupViewport(): PopupViewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function getPopupCardSize(card: HTMLElement): PopupCardSize {
  const rect = card.getBoundingClientRect();
  return {
    width: rect.width || card.offsetWidth || 0,
    height: rect.height || card.offsetHeight || 0,
  };
}

export function computeCardPosition(
  anchorRect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  cardSize: PopupCardSize,
  viewport: PopupViewport,
): PopupCardPosition {
  const viewportLeft = viewport.scrollX + CARD_VIEWPORT_MARGIN;
  const viewportRight = viewport.scrollX + viewport.width - CARD_VIEWPORT_MARGIN;
  const viewportTop = viewport.scrollY + CARD_VIEWPORT_MARGIN;
  const viewportBottom = viewport.scrollY + viewport.height - CARD_VIEWPORT_MARGIN;

  const anchorLeft = anchorRect.left + viewport.scrollX;
  const anchorTop = anchorRect.top + viewport.scrollY;
  const anchorBottom = anchorRect.bottom + viewport.scrollY;

  const maxLeft = Math.max(viewportLeft, viewportRight - cardSize.width);
  const left = clamp(anchorLeft, viewportLeft, maxLeft);

  const belowTop = anchorBottom + CARD_GAP;
  const aboveTop = anchorTop - cardSize.height - CARD_GAP;
  const fitsBelow = belowTop + cardSize.height <= viewportBottom;
  const fitsAbove = aboveTop >= viewportTop;
  const spaceBelow = viewportBottom - belowTop;
  const spaceAbove = anchorTop - CARD_GAP - viewportTop;

  const placement: 'above' | 'below' =
    fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove)
      ? 'below'
      : 'above';

  const preferredTop = placement === 'below' ? belowTop : aboveTop;
  const maxTop = Math.max(viewportTop, viewportBottom - cardSize.height);
  const top = clamp(preferredTop, viewportTop, maxTop);

  return { left, top, placement };
}

function unwrapMark(mark: Element): void {
  const parent = mark.parentNode;
  if (!parent) return;

  const text = document.createTextNode(mark.textContent || '');
  parent.replaceChild(text, mark);
  parent.normalize();
}

function disposeMark(mark: HTMLElement): void {
  if (mark.tagName === TAG.toUpperCase()) {
    unwrapMark(mark);
    return;
  }

  mark.remove();
}

/** Returns true when a popup card is currently visible */
export function isCardOpen(): boolean {
  return activeCard !== null;
}

/** Close any open card */
function closeCard() {
  if (activeCard) {
    activeCard.remove();
    activeCard = null;
  }
  if (activeMark) {
    activeMark.style.outline = '';
    activeMark = null;
  }
}

/** Close card when clicking outside */
document.addEventListener('click', (e) => {
  if (activeCard && !activeCard.contains(e.target as Node) &&
      activeMark && !activeMark.contains(e.target as Node)) {
    closeCard();
  }
});

/** Build and show the card popup for an issue */
function showCard(
  mark: HTMLElement,
  issue: Issue,
  onApply: (issue: Issue) => void,
  onIgnore: () => void,
  onIgnoreAll: () => void,
) {
  closeCard();

  activeMark = mark;
  // no outline on active mark — card popup is sufficient

  const card = document.createElement('div');
  card.className = 'stet-card';
  if (mark.dataset.stetHost) {
    card.dataset.stetHost = mark.dataset.stetHost;
  }

  // Header: rule badge + close button
  const header = document.createElement('div');
  header.className = 'stet-card-header';

  const ruleBadge = document.createElement('span');
  ruleBadge.className = 'stet-card-rule';
  ruleBadge.textContent = issue.rule;
  header.appendChild(ruleBadge);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'stet-card-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });
  header.appendChild(closeBtn);
  card.appendChild(header);

  // Description
  const desc = document.createElement('div');
  desc.className = 'stet-card-description';
  desc.textContent = issue.description;
  card.appendChild(desc);

  // Suggestion chips
  if (typeof issue.suggestion === 'string') {
    const suggestions = document.createElement('div');
    suggestions.className = 'stet-suggestions';
    const suggestionLabel = issue.suggestion.length > 0 ? issue.suggestion : 'remove';

    // Show original → suggestion
    const chip = document.createElement('button');
    chip.className = 'stet-suggestion-chip';
    const original = document.createElement('span');
    original.className = 'stet-card-original';
    original.textContent = issue.originalText;

    const arrow = document.createElement('span');
    arrow.className = 'stet-card-arrow';
    arrow.textContent = '\u2192';

    chip.append(original, arrow, document.createTextNode(suggestionLabel));
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCard();
      onApply(issue);
    });
    suggestions.appendChild(chip);
    card.appendChild(suggestions);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'stet-card-actions';

  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'stet-action-btn';
  ignoreBtn.textContent = 'Ignore';
  ignoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCard();
    onIgnore();
  });
  actions.appendChild(ignoreBtn);

  const ignoreAllBtn = document.createElement('button');
  ignoreAllBtn.className = 'stet-action-btn';
  ignoreAllBtn.textContent = 'Ignore all';
  ignoreAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCard();
    onIgnoreAll();
  });
  actions.appendChild(ignoreAllBtn);

  card.appendChild(actions);

  // Position the card next to the mark while keeping it inside the viewport.
  document.body.appendChild(card);
  const position = computeCardPosition(
    mark.getBoundingClientRect(),
    getPopupCardSize(card),
    getPopupViewport(),
  );
  card.style.left = `${position.left}px`;
  card.style.top = `${position.top}px`;

  activeCard = card;
}

export class AnnotationManager {
  private element: HTMLElement;
  private inlineMarks: HTMLElement[] = [];
  private overlayMarks: HTMLElement[] = [];
  private overlayRoot: HTMLElement | null = null;
  private onApplyIssue?: (issue: Issue) => boolean | Promise<boolean>;
  private onIgnoreIssue?: (issue: Issue) => void;
  private onIgnoreIssueFamily?: (fingerprint: string, issue: Issue) => void;
  private lastIssues: Issue[] = [];
  private lastMode: AnnotationRenderMode = 'inline';
  private dismissedIssueKeys = new Set<string>();
  private dismissedFingerprints = new Set<string>();
  private overlayTracking = false;
  private overlayRefreshFrame: number | null = null;
  private overlayReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private overlayFollowFrame: number | null = null;
  private overlayFollowUntil = 0;
  private overlaySuppressed = false;
  private overlayVisualOffsetX = 0;
  private overlayVisualOffsetY = 0;
  private overlayAnchorPosition: { left: number; top: number } | null = null;

  private readonly handleOverlayViewportChange = (event: Event) => {
    if (this.lastMode !== 'overlay') return;
    if (this.lastIssues.length === 0) return;
    if (this.overlaySuppressed) return;
    if (!this.element.isConnected) {
      this.clear();
      return;
    }

    if (event.type === 'scroll') {
      this.applyOverlayAnchorDelta();
      this.startOverlayFollowLoop();
      this.scheduleOverlayReconcile();
      return;
    }

    if (this.overlayRefreshFrame !== null) return;

    this.overlayRefreshFrame = window.requestAnimationFrame(() => {
      this.overlayRefreshFrame = null;
      this.renderOverlayAnnotations(this.getVisibleIssues(this.lastIssues), false);
    });
  };

  private readonly handleDocumentPointerDown = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (this.isWithinManagedUi(target)) {
      this.restoreOverlayVisibility();
      return;
    }

    this.suppressOverlayVisibility();
  };

  private readonly handleDocumentFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (this.isWithinManagedUi(target)) {
      this.restoreOverlayVisibility();
      return;
    }

    this.suppressOverlayVisibility();
  };

  constructor(element: HTMLElement, options: AnnotationManagerOptions = {}) {
    this.element = element;
    this.onApplyIssue = options.onApplyIssue;
    this.onIgnoreIssue = options.onIgnoreIssue;
    this.onIgnoreIssueFamily = options.onIgnoreIssueFamily;
  }

  destroy(): void {
    this.clear();
    this.stopOverlayTracking();
    if (this.overlayRefreshFrame !== null) {
      window.cancelAnimationFrame(this.overlayRefreshFrame);
      this.overlayRefreshFrame = null;
    }
    this.cancelOverlayReconcile();
    this.stopOverlayFollowLoop();
  }

  getRenderedMarkCount(): number {
    return this.inlineMarks.length + this.overlayMarks.length;
  }

  setIssues(issues: Issue[]): void {
    this.lastIssues = [...issues];
    this.dismissedIssueKeys.clear();
    this.dismissedFingerprints.clear();
  }

  private usesLiteralTextOffsets(): boolean {
    return this.element.dataset.stetTextareaMirror === 'true'
      || this.element.getAttribute('contenteditable') === 'plaintext-only';
  }

  private getInlineAnnotationText(): string {
    if (this.usesLiteralTextOffsets()) {
      return this.element.textContent || '';
    }

    return this.element.innerText || this.element.textContent || '';
  }

  /**
   * Build a text-node-to-innerText-offset map.
   * Uses indexOf on the element's innerText to find each text node's
   * true position, automatically accounting for \n/\n\n separators
   * that innerText inserts for <br> and block elements.
   */
  private buildNodeMap(): { node: Text; start: number; end: number }[] {
    const fullText = this.getInlineAnnotationText();
    const usesLiteralOffsets = this.usesLiteralTextOffsets();
    const entries: { node: Text; start: number; end: number }[] = [];
    const walker = document.createTreeWalker(this.element, NodeFilter.SHOW_TEXT);

    let searchFrom = 0;
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const content = node.textContent || '';
      if (!content) continue;

      // Skip whitespace-only nodes between block elements —
      // these don't appear in innerText
      if (!usesLiteralOffsets && !content.trim() && !content.includes('\u00a0')) continue;

      const idx = fullText.indexOf(content, searchFrom);
      if (idx >= 0) {
        entries.push({ node, start: idx, end: idx + content.length });
        searchFrom = idx + content.length;
      }
    }

    return entries;
  }

  private captureSelection(textNodes: { node: Text; start: number; end: number }[]): {
    start: number;
    end: number;
  } | null {
    const selection = this.element.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.startContainer) || !this.element.contains(range.endContainer)) {
      return null;
    }

    const start = this.resolveDomPointToOffset(range.startContainer, range.startOffset, textNodes);
    const end = this.resolveDomPointToOffset(range.endContainer, range.endOffset, textNodes);
    if (start === null || end === null) return null;

    return { start, end };
  }

  private resolveDomPointToOffset(
    container: Node,
    offset: number,
    textNodes: { node: Text; start: number; end: number }[],
  ): number | null {
    if (container instanceof Text) {
      const entry = textNodes.find((item) => item.node === container);
      if (!entry) return null;
      return entry.start + Math.min(Math.max(offset, 0), container.textContent?.length ?? 0);
    }

    try {
      const range = this.element.ownerDocument.createRange();
      range.selectNodeContents(this.element);
      range.setEnd(container, offset);
      return range.toString().length;
    } catch {
      return null;
    }
  }

  private resolveOffsetToDomPoint(
    offset: number,
    textNodes: { node: Text; start: number; end: number }[],
  ): { node: Node; offset: number } {
    if (textNodes.length === 0) {
      return { node: this.element, offset: 0 };
    }

    const clampedOffset = Math.max(0, offset);
    for (const entry of textNodes) {
      if (clampedOffset <= entry.end) {
        return {
          node: entry.node,
          offset: Math.max(0, Math.min(entry.node.textContent?.length ?? 0, clampedOffset - entry.start)),
        };
      }
    }

    const last = textNodes[textNodes.length - 1];
    return {
      node: last.node,
      offset: last.node.textContent?.length ?? 0,
    };
  }

  private restoreSelection(
    selectionState: { start: number; end: number } | null,
    textNodes: { node: Text; start: number; end: number }[],
  ): void {
    if (!selectionState) return;

    const selection = this.element.ownerDocument.getSelection();
    if (!selection) return;

    try {
      const start = this.resolveOffsetToDomPoint(selectionState.start, textNodes);
      const end = this.resolveOffsetToDomPoint(selectionState.end, textNodes);
      const range = this.element.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Ignore restore failures; keeping editing stable is best-effort here.
    }
  }

  private intersectsActiveSelection(
    issueStart: number,
    issueEnd: number,
    selectionState: { start: number; end: number } | null,
  ): boolean {
    if (!selectionState) return false;

    const start = Math.min(selectionState.start, selectionState.end);
    const end = Math.max(selectionState.start, selectionState.end);

    if (start === end) {
      // Skip if caret is inside or at end of issue, but not at start
      // (so first-word issues at offset 0 still get annotated)
      return start > issueStart && start <= issueEnd;
    }

    return issueStart < end && issueEnd > start;
  }

  clear(): void {
    closeCard();
    this.clearInlineMarks();
    this.clearOverlayMarks();
    this.stopOverlayTracking();
  }

  private clearInlineMarks(): void {
    for (const mark of this.inlineMarks) {
      disposeMark(mark);
    }
    this.inlineMarks = [];
  }

  private clearOverlayMarks(): void {
    for (const mark of this.overlayMarks) {
      disposeMark(mark);
    }
    this.overlayMarks = [];
    this.overlaySuppressed = false;
    this.resetOverlayVisualOffset();
    this.cancelOverlayReconcile();
    this.stopOverlayFollowLoop();
    this.overlayAnchorPosition = null;
    if (this.overlayRoot) {
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }
  }

  private removeIssueMarks(issueId: string): void {
    this.inlineMarks = this.inlineMarks.filter((mark) => {
      if (mark.dataset.issueId !== issueId) return true;
      disposeMark(mark);
      return false;
    });
    this.overlayMarks = this.overlayMarks.filter((mark) => {
      if (mark.dataset.issueId !== issueId) return true;
      disposeMark(mark);
      return false;
    });
    this.pruneOverlayRoot();
  }

  private removeFingerprintMarks(fingerprint: string): void {
    this.inlineMarks = this.inlineMarks.filter((mark) => {
      if (mark.dataset.fingerprint !== fingerprint) return true;
      disposeMark(mark);
      return false;
    });
    this.overlayMarks = this.overlayMarks.filter((mark) => {
      if (mark.dataset.fingerprint !== fingerprint) return true;
      disposeMark(mark);
      return false;
    });
    this.pruneOverlayRoot();
  }

  private removeMark(mark: HTMLElement): void {
    this.inlineMarks = this.inlineMarks.filter((entry) => {
      if (entry !== mark) return true;
      disposeMark(entry);
      return false;
    });
    this.overlayMarks = this.overlayMarks.filter((entry) => {
      if (entry !== mark) return true;
      disposeMark(entry);
      return false;
    });
    this.pruneOverlayRoot();
  }

  private pruneOverlayRoot(): void {
    if (this.overlayMarks.length > 0) return;
    if (this.overlayRoot) {
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }
    this.stopOverlayTracking();
  }

  private dismissIssue(issue: Issue): void {
    this.dismissedIssueKeys.add(getIssueKey(issue));
  }

  private dismissIssueFamily(fingerprint: string): void {
    this.dismissedFingerprints.add(fingerprint);
    this.lastIssues
      .filter((issue) => issue.fingerprint === fingerprint)
      .forEach((issue) => {
        this.dismissedIssueKeys.add(getIssueKey(issue));
      });
  }

  private async applyIssue(issue: Issue, mark: HTMLElement): Promise<void> {
    const applied = this.onApplyIssue ? await this.onApplyIssue(issue) : true;
    if (applied === false) return;

    this.dismissIssue(issue);
    if (issue.issueId) {
      this.removeIssueMarks(issue.issueId);
    } else {
      this.removeMark(mark);
    }
  }

  private getVisibleIssues(issues: Issue[]): Issue[] {
    return issues.filter((issue) => {
      if (this.dismissedIssueKeys.has(getIssueKey(issue))) return false;
      if (issue.fingerprint && this.dismissedFingerprints.has(issue.fingerprint)) return false;
      return true;
    });
  }

  annotate(issues: Issue[], mode: AnnotationRenderMode = 'inline'): void {
    this.setIssues(issues);
    this.lastMode = mode;

    if (mode === 'overlay') {
      this.renderOverlayAnnotations(issues, true);
      return;
    }

    this.renderInlineAnnotations(issues);
  }

  private renderInlineAnnotations(issues: Issue[]): void {
    const startedAt = getNow();
    const selectionBefore = this.captureSelection(this.buildNodeMap());
    const clearedMarks = this.getRenderedMarkCount();
    this.clear();
    if (issues.length === 0) {
      logHistoryEvent('checker:annotate', {
        ...getAnnotationElementLogData(this.element),
        mode: 'inline',
        issueCount: 0,
        clearedMarks,
        appliedMarks: 0,
        skippedSelectionCount: 0,
        surroundFailureCount: 0,
        elapsedMs: getElapsedMs(startedAt),
      });
      return;
    }

    const sorted = [...issues].sort((a, b) => b.offset - a.offset);
    const fullText = this.getInlineAnnotationText();

    // Build text node map aligned to innerText offsets.
    // innerText inserts \n for <br> and \n\n for block elements,
    // but TreeWalker only sees raw text nodes. We correlate each
    // text node to its position in innerText via sequential indexOf.
    const textNodes = this.buildNodeMap();
    let skippedSelectionCount = 0;
    let surroundFailureCount = 0;

    for (const issue of sorted) {
      const resolvedRange = resolveIssueRange(fullText, issue);
      if (!resolvedRange) continue;

      const issueStart = resolvedRange.start;
      const issueEnd = resolvedRange.end;

      if (this.intersectsActiveSelection(issueStart, issueEnd, selectionBefore)) {
        skippedSelectionCount += 1;
        continue;
      }

      for (const tn of textNodes) {
        if (tn.end <= issueStart || tn.start >= issueEnd) continue;

        const relStart = Math.max(0, issueStart - tn.start);
        const relEnd = Math.min(tn.node.textContent!.length, issueEnd - tn.start);
        if (relStart >= relEnd) continue;

        try {
          const range = document.createRange();
          range.setStart(tn.node, relStart);
          range.setEnd(tn.node, relEnd);

          const mark = document.createElement(TAG);
          mark.dataset.rule = issue.rule;
          mark.dataset.severity = issue.severity;
          mark.dataset.stetAnnotationMark = 'true';
          if (issue.issueId) mark.dataset.issueId = issue.issueId;
          if (issue.fingerprint) mark.dataset.fingerprint = issue.fingerprint;

          // Click to show card
          mark.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            showCard(mark, issue,
              // onApply
              (selectedIssue) => {
                void this.applyIssue(selectedIssue, mark);
              },
              // onIgnore
              () => {
                this.dismissIssue(issue);
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                } else {
                  this.removeMark(mark);
                }
                this.onIgnoreIssue?.(issue);
              },
              // onIgnoreAll
              () => {
                if (issue.fingerprint) {
                  this.dismissIssueFamily(issue.fingerprint);
                  this.removeFingerprintMarks(issue.fingerprint);
                  this.onIgnoreIssueFamily?.(issue.fingerprint, issue);
                  return;
                }

                this.dismissIssue(issue);
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                } else {
                  this.removeMark(mark);
                }
                this.onIgnoreIssue?.(issue);
              },
            );
          });

          range.surroundContents(mark);
          this.inlineMarks.push(mark);
        } catch {
          // surroundContents can fail on cross-boundary ranges
          surroundFailureCount += 1;
        }

        break;
      }
    }

    // Do NOT restore selection — surroundContents changes the DOM structure
    // and restoreSelection can misplace the caret. The intersectsActiveSelection
    // skip ensures no mark wraps the text node at the cursor, so the browser
    // maintains cursor position naturally through the remote DOM changes.
    logHistoryEvent('checker:annotate', {
      ...getAnnotationElementLogData(this.element),
      mode: 'inline',
      issueCount: issues.length,
      clearedMarks,
      appliedMarks: this.inlineMarks.length,
      skippedSelectionCount,
      surroundFailureCount,
      elapsedMs: getElapsedMs(startedAt),
    }, { level: surroundFailureCount > 0 ? 'warn' : 'debug' });
  }

  private renderOverlayAnnotations(issues: Issue[], logResult: boolean): void {
    const startedAt = getNow();
    const clearedMarks = this.getRenderedMarkCount();
    this.clear();

    if (issues.length === 0) {
      if (logResult) {
        logHistoryEvent('checker:annotate', {
          ...getAnnotationElementLogData(this.element),
          mode: 'overlay',
          issueCount: 0,
          clearedMarks,
          appliedMarks: 0,
          skippedSelectionCount: 0,
          surroundFailureCount: 0,
          elapsedMs: getElapsedMs(startedAt),
        });
      }
      return;
    }

    const overlayRoot = this.ensureOverlayRoot();
    const isGoogleDocs = isGoogleDocsSurfaceRoot(this.element);
    const fullText = isGoogleDocs
      ? extractGoogleDocsRenderedText(this.element)
      : (this.element.innerText || this.element.textContent || '');
    const textNodes = isGoogleDocs ? [] : this.buildNodeMap();
    let unresolvedIssueCount = 0;
    let rectFailureCount = 0;
    let cappedCount = 0;

    // Use a DocumentFragment to batch all mark appends into a single DOM write
    const fragment = document.createDocumentFragment();

    for (const issue of issues) {
      // Cap overlay mark count to avoid excessive DOM churn
      if (this.overlayMarks.length >= MAX_OVERLAY_MARKS) {
        cappedCount = issues.length - issues.indexOf(issue);
        logHistoryEvent('checker:overlay-capped', {
          ...getAnnotationElementLogData(this.element),
          cap: MAX_OVERLAY_MARKS,
          totalIssues: issues.length,
          renderedMarks: this.overlayMarks.length,
          skippedIssues: cappedCount,
        });
        break;
      }

      const resolvedRange = resolveIssueRange(fullText, issue);
      if (!resolvedRange) {
        unresolvedIssueCount += 1;
        continue;
      }

      const rects = isGoogleDocs
        ? collectGoogleDocsIssueRects(this.element, resolvedRange.start, resolvedRange.end, fullText)
        : this.collectDomRangeRects(textNodes, resolvedRange.start, resolvedRange.end);
      if (rects.length === 0) {
        rectFailureCount += 1;
        continue;
      }

      for (const rect of rects) {
        if (this.overlayMarks.length >= MAX_OVERLAY_MARKS) break;
        const mark = this.createOverlayMark(issue, rect);
        fragment.appendChild(mark);
        this.overlayMarks.push(mark);
      }
    }

    // Single DOM write for all marks
    overlayRoot.appendChild(fragment);

    if (this.overlayMarks.length === 0) {
      this.clearOverlayMarks();
      this.stopOverlayTracking();
    } else {
      this.startOverlayTracking();
      this.captureOverlayAnchorPosition();
    }

    if (logResult) {
      logHistoryEvent('checker:annotate', {
        ...getAnnotationElementLogData(this.element),
        mode: 'overlay',
        issueCount: issues.length,
        clearedMarks,
        appliedMarks: this.overlayMarks.length,
        skippedSelectionCount: 0,
        surroundFailureCount: 0,
        unresolvedIssueCount,
        rectFailureCount,
        cappedCount,
        elapsedMs: getElapsedMs(startedAt),
      }, { level: rectFailureCount > 0 || unresolvedIssueCount > 0 ? 'warn' : 'debug' });
    }
  }

  private ensureOverlayRoot(): HTMLElement {
    if (this.overlayRoot?.isConnected) return this.overlayRoot;

    const root = document.createElement('div');
    root.className = 'stet-overlay-root';
    root.setAttribute('aria-hidden', 'true');
    if (isGoogleDocsSurfaceRoot(this.element)) {
      root.dataset.stetHost = 'google-docs';
    }
    root.hidden = this.overlaySuppressed;
    (document.body ?? document.documentElement).appendChild(root);
    this.overlayRoot = root;
    return root;
  }

  private cancelOverlayReconcile(): void {
    if (this.overlayReconcileTimer === null) return;
    window.clearTimeout(this.overlayReconcileTimer);
    this.overlayReconcileTimer = null;
  }

  private scheduleOverlayReconcile(): void {
    this.cancelOverlayReconcile();
    this.overlayReconcileTimer = window.setTimeout(() => {
      this.overlayReconcileTimer = null;
      if (this.lastMode !== 'overlay') return;
      if (this.lastIssues.length === 0) return;
      if (this.overlaySuppressed) return;
      if (!this.element.isConnected) {
        this.clear();
        return;
      }
      this.renderOverlayAnnotations(this.getVisibleIssues(this.lastIssues), false);
    }, OVERLAY_RECONCILE_DELAY_MS);
  }

  private resetOverlayVisualOffset(): void {
    this.overlayVisualOffsetX = 0;
    this.overlayVisualOffsetY = 0;
    if (this.overlayRoot) {
      this.overlayRoot.style.transform = '';
    }
  }

  private applyOverlayVisualOffset(deltaX: number, deltaY: number): void {
    if (!this.overlayRoot) return;
    if (deltaX === 0 && deltaY === 0) return;

    this.overlayVisualOffsetX += deltaX;
    this.overlayVisualOffsetY += deltaY;
    this.overlayRoot.style.transform =
      `translate3d(${this.overlayVisualOffsetX}px, ${this.overlayVisualOffsetY}px, 0)`;
  }

  private captureOverlayAnchorPosition(): void {
    this.overlayAnchorPosition = this.getOverlayAnchorPosition();
  }

  private getOverlayAnchorPosition(): { left: number; top: number } | null {
    const rect = isGoogleDocsSurfaceRoot(this.element)
      ? (getGoogleDocsViewportAnchorRect(this.element) ?? this.element.getBoundingClientRect())
      : this.element.getBoundingClientRect();

    if (!rect || (rect.width === 0 && rect.height === 0)) return null;

    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
    };
  }

  private applyOverlayAnchorDelta(): void {
    const position = this.getOverlayAnchorPosition();
    if (!position) return;

    const previous = this.overlayAnchorPosition;
    this.overlayAnchorPosition = position;
    if (!previous) return;

    this.applyOverlayVisualOffset(position.left - previous.left, position.top - previous.top);
  }

  private startOverlayFollowLoop(): void {
    this.overlayFollowUntil = performance.now() + OVERLAY_FOLLOW_SCROLL_MS;
    if (this.overlayFollowFrame !== null) return;

    const tick = () => {
      this.overlayFollowFrame = null;
      if (this.lastMode !== 'overlay' || this.overlaySuppressed || !this.element.isConnected) return;

      this.applyOverlayAnchorDelta();
      if (performance.now() >= this.overlayFollowUntil) return;

      this.overlayFollowFrame = window.requestAnimationFrame(tick);
    };

    this.overlayFollowFrame = window.requestAnimationFrame(tick);
  }

  private stopOverlayFollowLoop(): void {
    this.overlayFollowUntil = 0;
    if (this.overlayFollowFrame === null) return;
    window.cancelAnimationFrame(this.overlayFollowFrame);
    this.overlayFollowFrame = null;
  }

  private isWithinManagedUi(target: Element): boolean {
    if (this.element.contains(target)) return true;
    return !!target.closest(EXTENSION_UI_SELECTOR);
  }

  private suppressOverlayVisibility(): void {
    if (this.lastMode !== 'overlay') return;
    if (this.overlayMarks.length === 0) return;
    this.overlaySuppressed = true;
    if (this.overlayRoot) {
      this.overlayRoot.hidden = true;
    }
    closeCard();
  }

  private restoreOverlayVisibility(): void {
    if (!this.overlaySuppressed) return;
    this.overlaySuppressed = false;

    if (this.lastMode !== 'overlay' || this.lastIssues.length === 0) {
      if (this.overlayRoot) this.overlayRoot.hidden = false;
      return;
    }

    this.renderOverlayAnnotations(this.getVisibleIssues(this.lastIssues), false);
  }

  private collectDomRangeRects(
    textNodes: { node: Text; start: number; end: number }[],
    startOffset: number,
    endOffset: number,
  ): DOMRect[] {
    const start = this.resolveOffsetToDomPoint(startOffset, textNodes);
    const end = this.resolveOffsetToDomPoint(endOffset, textNodes);
    const range = document.createRange();

    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      return [];
    }

    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }

  private createOverlayMark(issue: Issue, rect: DOMRect | { left: number; top: number; width: number; height: number; bottom: number }): HTMLElement {
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'stet-overlay-mark';
    mark.dataset.rule = issue.rule;
    mark.dataset.severity = issue.severity;
    mark.dataset.stetAnnotationMark = 'true';
    if (isGoogleDocsSurfaceRoot(this.element)) mark.dataset.stetHost = 'google-docs';
    if (issue.issueId) mark.dataset.issueId = issue.issueId;
    if (issue.fingerprint) mark.dataset.fingerprint = issue.fingerprint;

    const underlineHeight = Math.max(6, Math.min(12, Math.round(rect.height * 0.45)));
    const left = Math.max(0, rect.left + window.scrollX);
    const top = Math.max(0, rect.bottom + window.scrollY - underlineHeight);
    const width = Math.max(8, rect.width);

    mark.style.left = `${left}px`;
    mark.style.top = `${top}px`;
    mark.style.width = `${width}px`;
    mark.style.height = `${underlineHeight}px`;

    mark.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      showCard(mark, issue,
        (selectedIssue) => {
          void this.applyIssue(selectedIssue, mark);
        },
        () => {
          this.dismissIssue(issue);
          if (issue.issueId) {
            this.removeIssueMarks(issue.issueId);
          } else {
            this.removeMark(mark);
          }
          this.onIgnoreIssue?.(issue);
        },
        () => {
          if (issue.fingerprint) {
            this.dismissIssueFamily(issue.fingerprint);
            this.removeFingerprintMarks(issue.fingerprint);
            this.onIgnoreIssueFamily?.(issue.fingerprint, issue);
            return;
          }

          this.dismissIssue(issue);
          if (issue.issueId) {
            this.removeIssueMarks(issue.issueId);
          } else {
            this.removeMark(mark);
          }
          this.onIgnoreIssue?.(issue);
        },
      );
    });

    return mark;
  }

  private startOverlayTracking(): void {
    if (this.overlayTracking) return;
    this.overlayTracking = true;
    window.addEventListener('resize', this.handleOverlayViewportChange);
    document.addEventListener('scroll', this.handleOverlayViewportChange, true);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('focusin', this.handleDocumentFocusIn, true);
  }

  private stopOverlayTracking(): void {
    if (!this.overlayTracking) return;
    this.overlayTracking = false;
    window.removeEventListener('resize', this.handleOverlayViewportChange);
    document.removeEventListener('scroll', this.handleOverlayViewportChange, true);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.removeEventListener('focusin', this.handleDocumentFocusIn, true);
    this.cancelOverlayReconcile();
    this.stopOverlayFollowLoop();
    this.overlayAnchorPosition = null;
  }
}

function getAnnotationElementLogData(element: HTMLElement): Record<string, unknown> {
  return {
    descriptor: element.id ? `${element.tagName.toLowerCase()}#${element.id}` : element.tagName.toLowerCase(),
    textLength: isGoogleDocsSurfaceRoot(element)
      ? extractGoogleDocsRenderedText(element).length
      : (element.innerText || element.textContent || '').length,
  };
}

function getIssueKey(issue: Issue): string {
  if (issue.issueId) return issue.issueId;
  if (issue.fingerprint) return `fp:${issue.fingerprint}:${issue.offset}:${issue.length}`;
  return `${issue.rule}:${issue.offset}:${issue.length}:${issue.originalText}`;
}
