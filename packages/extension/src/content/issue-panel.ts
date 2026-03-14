import type { Issue } from 'stet';
import { setManagedVisibility } from './ui-visibility.js';

type ApplySelectedFixes = (element: HTMLElement, issueKeys: string[]) => Promise<number>;

export class IssuePanelManager {
  private readonly issuesByElement = new Map<HTMLElement, Issue[]>();
  private readonly selectedByElement = new Map<HTMLElement, Set<string>>();
  private activeElement: HTMLElement | null = null;
  private isOpen = false;

  private readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly buttonTitle = document.createElement('span');
  private readonly buttonMeta = document.createElement('span');
  private readonly panel = document.createElement('aside');
  private readonly headerTitle = document.createElement('div');
  private readonly summary = document.createElement('div');
  private readonly issueList = document.createElement('div');
  private readonly emptyState = document.createElement('div');
  private readonly applyButton = document.createElement('button');

  constructor(private readonly applySelectedFixes: ApplySelectedFixes) {
    this.buildUi();
  }

  setActiveElement(element: HTMLElement | null) {
    this.activeElement = element?.isConnected ? element : null;
    this.renderButton();
    if (this.isOpen) this.renderPanel();
  }

  updateIssues(element: HTMLElement, issues: Issue[]) {
    this.issuesByElement.set(element, issues);
    this.selectedByElement.set(element, buildDefaultSelection(issues, this.selectedByElement.get(element)));

    if (this.activeElement === element) {
      this.renderButton();
      if (this.isOpen) this.renderPanel();
    }
  }

  removeElement(element: HTMLElement) {
    this.issuesByElement.delete(element);
    this.selectedByElement.delete(element);
    if (this.activeElement === element) {
      this.activeElement = null;
      this.close();
      this.renderButton();
    }
  }

  private buildUi() {
    this.root.className = 'stet-issues-root';

    this.button.className = 'stet-issues-button';
    this.button.type = 'button';
    this.button.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    this.buttonTitle.className = 'stet-issues-button-title';
    this.buttonTitle.textContent = 'Issues';
    this.buttonMeta.className = 'stet-issues-button-meta';
    this.button.append(this.buttonTitle, this.buttonMeta);

    this.panel.className = 'stet-issues-panel';

    const header = document.createElement('div');
    header.className = 'stet-issues-panel-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'stet-issues-panel-title-group';

    const heading = document.createElement('h2');
    heading.className = 'stet-issues-panel-title';
    heading.textContent = 'Issue list';

    this.headerTitle.className = 'stet-issues-panel-target';
    this.summary.className = 'stet-issues-panel-summary';

    titleGroup.append(heading, this.headerTitle, this.summary);

    const closeButton = document.createElement('button');
    closeButton.className = 'stet-issues-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    header.append(titleGroup, closeButton);

    this.issueList.className = 'stet-issues-list';
    this.issueList.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement | null;
      if (!input?.matches('[data-issue-key]')) return;
      const issueKey = input.dataset.issueKey;
      if (!issueKey || !this.activeElement) return;
      const selected = this.selectedByElement.get(this.activeElement) ?? new Set<string>();
      if (input.checked) selected.add(issueKey);
      else selected.delete(issueKey);
      this.selectedByElement.set(this.activeElement, selected);
      this.renderPanel();
    });

    this.emptyState.className = 'stet-issues-empty';
    this.emptyState.textContent = 'No issues for the focused editor right now.';

    this.applyButton.className = 'stet-issues-primary-btn';
    this.applyButton.type = 'button';
    this.applyButton.addEventListener('click', () => {
      void this.applySelected();
    });

    this.panel.append(header, this.issueList, this.emptyState, this.applyButton);
    this.root.append(this.button, this.panel);
    (document.body ?? document.documentElement).appendChild(this.root);
    setManagedVisibility(this.root, false, 'flex');
    setManagedVisibility(this.button, false, 'flex');
    setManagedVisibility(this.panel, false, 'flex');
  }

  private open() {
    this.isOpen = true;
    setManagedVisibility(this.root, true, 'flex');
    setManagedVisibility(this.button, true, 'flex');
    setManagedVisibility(this.panel, true, 'flex');
    this.renderPanel();
  }

  private close() {
    this.isOpen = false;
    setManagedVisibility(this.panel, false, 'flex');
  }

  private renderButton() {
    const issues = this.activeElement ? (this.issuesByElement.get(this.activeElement) ?? []) : [];
    const fixable = issues.filter(isFixableIssue);

    if (this.activeElement === null) {
      setManagedVisibility(this.panel, false, 'flex');
      setManagedVisibility(this.button, false, 'flex');
      setManagedVisibility(this.root, false, 'flex');
      return;
    }

    setManagedVisibility(this.root, true, 'flex');
    setManagedVisibility(this.button, true, 'flex');
    if (!this.isOpen) {
      setManagedVisibility(this.panel, false, 'flex');
    }

    this.buttonMeta.textContent = issues.length === 0
      ? 'No issues detected'
      : `${issues.length} issue${issues.length === 1 ? '' : 's'} · ${fixable.length} fixable`;
  }

  private renderPanel() {
    if (!this.activeElement) {
      this.close();
      return;
    }

    const issues = this.issuesByElement.get(this.activeElement) ?? [];
    const selected = this.selectedByElement.get(this.activeElement) ?? new Set<string>();

    this.headerTitle.textContent = getTargetTitle(this.activeElement);
    this.summary.textContent = issues.length === 0
      ? 'Stet will refresh this list after each check.'
      : 'Uncheck anything you do not want included in bulk apply.';

    this.issueList.replaceChildren();
    this.emptyState.hidden = issues.length > 0;

    for (const issue of issues) {
      const issueKey = getIssueSelectionKey(issue);
      const fixable = isFixableIssue(issue);

      const row = document.createElement('label');
      row.className = `stet-issues-item${fixable ? '' : ' is-readonly'}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.issueKey = issueKey;
      checkbox.checked = fixable && selected.has(issueKey);
      checkbox.disabled = !fixable;
      checkbox.className = 'stet-issues-checkbox';

      const content = document.createElement('div');
      content.className = 'stet-issues-item-content';

      const title = document.createElement('div');
      title.className = 'stet-issues-item-title';
      title.textContent = issue.rule;

      const text = document.createElement('div');
      text.className = 'stet-issues-item-text';
      text.textContent = issue.suggestion
        ? `${issue.originalText} -> ${issue.suggestion}`
        : issue.originalText;

      const description = document.createElement('div');
      description.className = 'stet-issues-item-description';
      description.textContent = issue.description;

      content.append(title, text, description);
      row.append(checkbox, content);
      this.issueList.appendChild(row);
    }

    const selectedCount = [...selected].length;
    this.applyButton.disabled = selectedCount === 0;
    this.applyButton.textContent = selectedCount === 0
      ? 'No selected fixes'
      : `Apply selected (${selectedCount})`;
  }

  private async applySelected() {
    if (!this.activeElement) return;

    const selected = this.selectedByElement.get(this.activeElement) ?? new Set<string>();
    if (selected.size === 0) return;

    this.applyButton.disabled = true;
    this.applyButton.textContent = 'Applying...';

    const applied = await this.applySelectedFixes(this.activeElement, [...selected]);
    this.applyButton.textContent = applied > 0 ? `Applied ${applied} fix${applied === 1 ? '' : 'es'}` : 'Nothing applied';
  }
}

function buildDefaultSelection(issues: Issue[], existing: Set<string> | undefined): Set<string> {
  const next = new Set<string>();
  const existingKeys = existing ?? new Set<string>();

  for (const issue of issues) {
    if (!isFixableIssue(issue)) continue;
    const key = getIssueSelectionKey(issue);
    if (existingKeys.size === 0 || existingKeys.has(key)) {
      next.add(key);
    }
  }

  return next;
}

function isFixableIssue(issue: Issue): boolean {
  return issue.canFix && typeof issue.suggestion === 'string';
}

export function getIssueSelectionKey(issue: Issue): string {
  if (issue.fingerprint) return `${issue.fingerprint}:${issue.offset}:${issue.length}`;
  return `${issue.rule}:${issue.offset}:${issue.length}:${issue.originalText}`;
}

function getTargetTitle(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  if (element.id) return `#${element.id}`;
  return element.tagName.toLowerCase();
}
