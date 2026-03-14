/**
 * AnnotationManager — LanguageTool-style inline annotations.
 *
 * - Colored underlines by severity (red=error, orange=warning, blue=info)
 * - Click to open card popup with rule info, suggestion chips, ignore buttons
 * - Suggestion chips apply fixes via the checker replacement pipeline
 * - Ignore / Ignore all dismiss the issue
 */

import type { Issue } from 'stet';
import { resolveIssueRange } from './issue-range.js';
import { getElapsedMs, getNow, logHistoryEvent } from './version-history-debug.js';

const TAG = 'stet-mark';

/** Currently open popup card */
let activeCard: HTMLElement | null = null;
/** Currently active mark (the one whose card is open) */
let activeMark: HTMLElement | null = null;

interface AnnotationManagerOptions {
  onApplyIssue?: (issue: Issue) => void;
}

export type AnnotationRenderMode = 'inline' | 'overlay';

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
  mark.style.outline = '2px solid rgba(49, 130, 206, 0.4)';

  const card = document.createElement('div');
  card.className = 'stet-card';

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
      onApply(issue);
      closeCard();
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
    onIgnore();
    closeCard();
  });
  actions.appendChild(ignoreBtn);

  const ignoreAllBtn = document.createElement('button');
  ignoreAllBtn.className = 'stet-action-btn';
  ignoreAllBtn.textContent = 'Ignore all';
  ignoreAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onIgnoreAll();
    closeCard();
  });
  actions.appendChild(ignoreAllBtn);

  card.appendChild(actions);

  // Position the card below the mark
  document.body.appendChild(card);
  const rect = mark.getBoundingClientRect();
  card.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  card.style.top = `${rect.bottom + window.scrollY + 6}px`;

  // Keep card in viewport
  const cardRect = card.getBoundingClientRect();
  if (cardRect.right > window.innerWidth - 8) {
    card.style.left = `${window.innerWidth - cardRect.width - 8 + window.scrollX}px`;
  }

  activeCard = card;
}

export class AnnotationManager {
  private element: HTMLElement;
  private inlineMarks: HTMLElement[] = [];
  private overlayMarks: HTMLElement[] = [];
  private overlayRoot: HTMLElement | null = null;
  private onApplyIssue?: (issue: Issue) => void;
  private lastIssues: Issue[] = [];
  private lastMode: AnnotationRenderMode = 'inline';
  private dismissedIssueKeys = new Set<string>();
  private dismissedFingerprints = new Set<string>();
  private overlayTracking = false;
  private overlayRefreshFrame: number | null = null;

  private readonly handleOverlayViewportChange = () => {
    if (this.lastMode !== 'overlay') return;
    if (this.lastIssues.length === 0) return;
    if (!this.element.isConnected) {
      this.clear();
      return;
    }
    if (this.overlayRefreshFrame !== null) return;

    this.overlayRefreshFrame = window.requestAnimationFrame(() => {
      this.overlayRefreshFrame = null;
      this.renderOverlayAnnotations(this.getVisibleIssues(this.lastIssues), false);
    });
  };

  constructor(element: HTMLElement, options: AnnotationManagerOptions = {}) {
    this.element = element;
    this.onApplyIssue = options.onApplyIssue;
  }

  destroy(): void {
    this.clear();
    this.stopOverlayTracking();
    if (this.overlayRefreshFrame !== null) {
      window.cancelAnimationFrame(this.overlayRefreshFrame);
      this.overlayRefreshFrame = null;
    }
  }

  getRenderedMarkCount(): number {
    return this.inlineMarks.length + this.overlayMarks.length;
  }

  /**
   * Build a text-node-to-innerText-offset map.
   * Uses indexOf on the element's innerText to find each text node's
   * true position, automatically accounting for \n/\n\n separators
   * that innerText inserts for <br> and block elements.
   */
  private buildNodeMap(): { node: Text; start: number; end: number }[] {
    const innerText = this.element.innerText || this.element.textContent || '';
    const entries: { node: Text; start: number; end: number }[] = [];
    const walker = document.createTreeWalker(this.element, NodeFilter.SHOW_TEXT);

    let searchFrom = 0;
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const content = node.textContent || '';
      if (!content) continue;

      // Skip whitespace-only nodes between block elements —
      // these don't appear in innerText
      if (!content.trim() && !content.includes('\u00a0')) continue;

      const idx = innerText.indexOf(content, searchFrom);
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
      return start >= issueStart && start <= issueEnd;
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
    if (issue.fingerprint) {
      this.dismissedFingerprints.add(issue.fingerprint);
    }
  }

  private dismissIssueFamily(fingerprint: string): void {
    this.dismissedFingerprints.add(fingerprint);
    this.lastIssues
      .filter((issue) => issue.fingerprint === fingerprint)
      .forEach((issue) => {
        this.dismissedIssueKeys.add(getIssueKey(issue));
      });
  }

  private getVisibleIssues(issues: Issue[]): Issue[] {
    return issues.filter((issue) => {
      if (this.dismissedIssueKeys.has(getIssueKey(issue))) return false;
      if (issue.fingerprint && this.dismissedFingerprints.has(issue.fingerprint)) return false;
      return true;
    });
  }

  annotate(issues: Issue[], mode: AnnotationRenderMode = 'inline'): void {
    this.lastIssues = [...issues];
    this.lastMode = mode;
    this.dismissedIssueKeys.clear();
    this.dismissedFingerprints.clear();

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
      this.restoreSelection(selectionBefore, this.buildNodeMap());
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
    const fullText = this.element.innerText || this.element.textContent || '';

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
                this.dismissIssue(selectedIssue);
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                } else {
                  this.removeMark(mark);
                }

                if (this.onApplyIssue) {
                  this.onApplyIssue(selectedIssue);
                  return;
                }
              },
              // onIgnore
              () => {
                this.dismissIssue(issue);
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                  return;
                }

                this.removeMark(mark);
              },
              // onIgnoreAll
              () => {
                if (issue.fingerprint) {
                  this.dismissIssueFamily(issue.fingerprint);
                  this.removeFingerprintMarks(issue.fingerprint);
                  return;
                }

                this.dismissIssue(issue);
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                  return;
                }

                this.removeMark(mark);
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

    this.restoreSelection(selectionBefore, this.buildNodeMap());
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
    const fullText = this.element.innerText || this.element.textContent || '';
    const textNodes = this.buildNodeMap();
    let unresolvedIssueCount = 0;
    let rectFailureCount = 0;

    for (const issue of issues) {
      const resolvedRange = resolveIssueRange(fullText, issue);
      if (!resolvedRange) {
        unresolvedIssueCount += 1;
        continue;
      }

      const start = this.resolveOffsetToDomPoint(resolvedRange.start, textNodes);
      const end = this.resolveOffsetToDomPoint(resolvedRange.end, textNodes);
      const range = document.createRange();

      try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
      } catch {
        rectFailureCount += 1;
        continue;
      }

      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) {
        rectFailureCount += 1;
        continue;
      }

      for (const rect of rects) {
        const mark = this.createOverlayMark(issue, rect);
        overlayRoot.appendChild(mark);
        this.overlayMarks.push(mark);
      }
    }

    if (this.overlayMarks.length === 0) {
      this.clearOverlayMarks();
      this.stopOverlayTracking();
    } else {
      this.startOverlayTracking();
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
        elapsedMs: getElapsedMs(startedAt),
      }, { level: rectFailureCount > 0 || unresolvedIssueCount > 0 ? 'warn' : 'debug' });
    }
  }

  private ensureOverlayRoot(): HTMLElement {
    if (this.overlayRoot?.isConnected) return this.overlayRoot;

    const root = document.createElement('div');
    root.className = 'stet-overlay-root';
    root.setAttribute('aria-hidden', 'true');
    (document.body ?? document.documentElement).appendChild(root);
    this.overlayRoot = root;
    return root;
  }

  private createOverlayMark(issue: Issue, rect: DOMRect | { left: number; top: number; width: number; height: number; bottom: number }): HTMLElement {
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'stet-overlay-mark';
    mark.dataset.rule = issue.rule;
    mark.dataset.severity = issue.severity;
    mark.dataset.stetAnnotationMark = 'true';
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
          this.dismissIssue(selectedIssue);
          if (issue.issueId) {
            this.removeIssueMarks(issue.issueId);
          } else {
            this.removeMark(mark);
          }

          if (this.onApplyIssue) {
            this.onApplyIssue(selectedIssue);
          }
        },
        () => {
          this.dismissIssue(issue);
          if (issue.issueId) {
            this.removeIssueMarks(issue.issueId);
            return;
          }

          this.removeMark(mark);
        },
        () => {
          if (issue.fingerprint) {
            this.dismissIssueFamily(issue.fingerprint);
            this.removeFingerprintMarks(issue.fingerprint);
            return;
          }

          this.dismissIssue(issue);
          if (issue.issueId) {
            this.removeIssueMarks(issue.issueId);
            return;
          }

          this.removeMark(mark);
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
  }

  private stopOverlayTracking(): void {
    if (!this.overlayTracking) return;
    this.overlayTracking = false;
    window.removeEventListener('resize', this.handleOverlayViewportChange);
    document.removeEventListener('scroll', this.handleOverlayViewportChange, true);
  }
}

function getAnnotationElementLogData(element: HTMLElement): Record<string, unknown> {
  return {
    descriptor: element.id ? `${element.tagName.toLowerCase()}#${element.id}` : element.tagName.toLowerCase(),
    textLength: (element.innerText || element.textContent || '').length,
  };
}

function getIssueKey(issue: Issue): string {
  if (issue.issueId) return issue.issueId;
  if (issue.fingerprint) return `fp:${issue.fingerprint}:${issue.offset}:${issue.length}`;
  return `${issue.rule}:${issue.offset}:${issue.length}:${issue.originalText}`;
}
