/**
 * AnnotationManager — LanguageTool-style inline annotations.
 *
 * - Colored underlines by severity (red=error, orange=warning, blue=info)
 * - Click to open card popup with rule info, suggestion chips, ignore buttons
 * - Suggestion chips apply the fix inline on click
 * - Ignore / Ignore all dismiss the issue
 */

import type { Issue } from 'stet';

const TAG = 'stet-mark';

/** Currently open popup card */
let activeCard: HTMLElement | null = null;
/** Currently active mark (the one whose card is open) */
let activeMark: HTMLElement | null = null;

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
function showCard(mark: HTMLElement, issue: Issue, onApply: (text: string) => void, onIgnore: () => void) {
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
  if (issue.suggestion) {
    const suggestions = document.createElement('div');
    suggestions.className = 'stet-suggestions';

    // Show original → suggestion
    const chip = document.createElement('button');
    chip.className = 'stet-suggestion-chip';
    chip.innerHTML = `<span class="stet-card-original">${issue.originalText}</span><span class="stet-card-arrow">\u2192</span>${issue.suggestion}`;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      onApply(issue.suggestion!);
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
        const parent = el.parentNode;
        if (parent) {
          const text = document.createTextNode(el.textContent || '');
          parent.replaceChild(text, el);
          parent.normalize();
        }
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

  constructor(element: HTMLElement) {
    this.element = element;
  }

  clear(): void {
    closeCard();
    for (const mark of this.marks) {
      const parent = mark.parentNode;
      if (parent) {
        const text = document.createTextNode(mark.textContent || '');
        parent.replaceChild(text, mark);
        parent.normalize();
      }
    }
    this.marks = [];
  }

  annotate(issues: Issue[]): void {
    this.clear();
    if (issues.length === 0) return;

    const sorted = [...issues].sort((a, b) => b.offset - a.offset);

    // Build flat text node map
    const textNodes: { node: Text; start: number; end: number }[] = [];
    let offset = 0;
    const walker = document.createTreeWalker(this.element, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const len = node.textContent?.length || 0;
      textNodes.push({ node, start: offset, end: offset + len });
      offset += len;
    }

    for (const issue of sorted) {
      const issueStart = issue.offset;
      const issueEnd = issue.offset + issue.length;

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
          if (issue.fingerprint) mark.dataset.fingerprint = issue.fingerprint;

          // Click to show card
          mark.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            showCard(mark, issue,
              // onApply
              (replacement) => {
                const parent = mark.parentNode;
                if (parent) {
                  const text = document.createTextNode(replacement);
                  parent.replaceChild(text, mark);
                  parent.normalize();
                }
              },
              // onIgnore
              () => {
                const parent = mark.parentNode;
                if (parent) {
                  const text = document.createTextNode(mark.textContent || '');
                  parent.replaceChild(text, mark);
                  parent.normalize();
                }
              },
            );
          });

          range.surroundContents(mark);
          this.marks.push(mark);
        } catch {
          // surroundContents can fail on cross-boundary ranges
        }

        break;
      }
    }
  }
}
