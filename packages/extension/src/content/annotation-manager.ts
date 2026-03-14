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

function unwrapMark(mark: Element): void {
  const parent = mark.parentNode;
  if (!parent) return;

  const text = document.createTextNode(mark.textContent || '');
  parent.replaceChild(text, mark);
  parent.normalize();
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
function showCard(mark: HTMLElement, issue: Issue, onApply: (issue: Issue) => void, onIgnore: () => void) {
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
    // Remove all marks with the same fingerprint
    const fp = mark.dataset.fingerprint;
    if (fp) {
      document.querySelectorAll(`${TAG}[data-fingerprint="${fp}"]`).forEach((el) => {
        unwrapMark(el);
      });
    } else {
      onIgnore();
    }
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
  private marks: HTMLElement[] = [];
  private onApplyIssue?: (issue: Issue) => void;

  constructor(element: HTMLElement, options: AnnotationManagerOptions = {}) {
    this.element = element;
    this.onApplyIssue = options.onApplyIssue;
  }

  /**
   * Build a text-node-to-innerText-offset map.
   * Uses indexOf on the element's innerText to find each text node's
   * true position, automatically accounting for \n/\n\n separators
   * that innerText inserts for <br> and block elements.
   */
  private buildNodeMap(): { node: Text; start: number; end: number }[] {
    const innerText = this.element.innerText || '';
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
    for (const mark of this.marks) {
      unwrapMark(mark);
    }
    this.marks = [];
  }

  private removeIssueMarks(issueId: string): void {
    this.marks = this.marks.filter((mark) => {
      if (mark.dataset.issueId !== issueId) return true;
      unwrapMark(mark);
      return false;
    });
  }

  annotate(issues: Issue[]): void {
    const startedAt = getNow();
    const selectionBefore = this.captureSelection(this.buildNodeMap());
    const clearedMarks = this.marks.length;
    this.clear();
    if (issues.length === 0) {
      this.restoreSelection(selectionBefore, this.buildNodeMap());
      logHistoryEvent('checker:annotate', {
        ...getAnnotationElementLogData(this.element),
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
    const fullText = this.element.innerText || '';

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
          if (issue.issueId) mark.dataset.issueId = issue.issueId;
          if (issue.fingerprint) mark.dataset.fingerprint = issue.fingerprint;

          // Click to show card
          mark.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            showCard(mark, issue,
              // onApply
              (selectedIssue) => {
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                } else {
                  unwrapMark(mark);
                }

                if (this.onApplyIssue) {
                  this.onApplyIssue(selectedIssue);
                  return;
                }
              },
              // onIgnore
              () => {
                if (issue.issueId) {
                  this.removeIssueMarks(issue.issueId);
                  return;
                }

                unwrapMark(mark);
              },
            );
          });

          range.surroundContents(mark);
          this.marks.push(mark);
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
      issueCount: issues.length,
      clearedMarks,
      appliedMarks: this.marks.length,
      skippedSelectionCount,
      surroundFailureCount,
      elapsedMs: getElapsedMs(startedAt),
    }, { level: surroundFailureCount > 0 ? 'warn' : 'debug' });
  }
}

function getAnnotationElementLogData(element: HTMLElement): Record<string, unknown> {
  return {
    descriptor: element.id ? `${element.tagName.toLowerCase()}#${element.id}` : element.tagName.toLowerCase(),
    textLength: element.innerText.length,
  };
}
