import {
  discoverHistoryEditables,
  findHistoryEditable,
  getEditableTarget,
  type EditableTarget,
} from './editable-target.js';
import { diffText } from './version-history-diff.js';
import {
  DEFAULT_HISTORY_POLICY,
  type EditableHistoryRecord,
  type VersionSnapshot,
} from './version-history-core.js';
import { loadHistoryRecord, saveSnapshotForTarget } from './version-history-store.js';

class HistorySession {
  public record: EditableHistoryRecord | null = null;

  private loadPromise: Promise<EditableHistoryRecord | null> | null = null;
  private writeChain: Promise<EditableHistoryRecord | null> = Promise.resolve(null);
  private saveTimer: number | null = null;
  private readonly handleInputBound: () => void;
  private readonly handleBlurBound: () => void;

  constructor(
    public readonly target: EditableTarget,
    private readonly onChange: () => void,
  ) {
    this.handleInputBound = () => {
      void this.ensureLoaded();
      this.scheduleAutosave();
    };
    this.handleBlurBound = () => {
      void this.persist('blur', true);
    };

    this.target.element.addEventListener('input', this.handleInputBound);
    this.target.element.addEventListener('blur', this.handleBlurBound, true);
  }

  async ensureLoaded(): Promise<EditableHistoryRecord | null> {
    if (this.record) return this.record;
    if (!this.loadPromise) {
      this.loadPromise = loadHistoryRecord(this.target.storageKey)
        .then((record) => {
          this.record = record;
          this.onChange();
          return record;
        })
        .finally(() => {
          this.loadPromise = null;
        });
    }

    return this.loadPromise;
  }

  async persist(source: 'autosave' | 'manual' | 'restore' | 'blur', force = false): Promise<EditableHistoryRecord | null> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.writeChain = this.writeChain.then(async () => {
      await this.ensureLoaded();
      const record = await saveSnapshotForTarget(
        this.target,
        this.target.read(),
        source,
        DEFAULT_HISTORY_POLICY,
        force,
      );
      this.record = record;
      this.onChange();
      return record;
    });

    return this.writeChain;
  }

  flushPending(): Promise<EditableHistoryRecord | null> {
    if (this.saveTimer !== null) {
      return this.persist('blur', true);
    }
    return this.writeChain;
  }

  destroy() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.target.element.removeEventListener('input', this.handleInputBound);
    this.target.element.removeEventListener('blur', this.handleBlurBound, true);
  }

  private scheduleAutosave() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      void this.persist('autosave');
    }, DEFAULT_HISTORY_POLICY.debounceMs);

    this.onChange();
  }
}

export function initVersionHistory() {
  const manager = new VersionHistoryManager();
  manager.init();
}

class VersionHistoryManager {
  private static readonly EDGE_MARGIN = 12;
  private static readonly GAP = 10;
  private static readonly FALLBACK_BUTTON_WIDTH = 196;
  private static readonly FALLBACK_BUTTON_HEIGHT = 58;
  private static readonly FALLBACK_PANEL_WIDTH = 420;
  private static readonly FALLBACK_PANEL_HEIGHT = 460;

  private readonly sessions = new Map<HTMLElement, HistorySession>();
  private activeSession: HistorySession | null = null;
  private selectedSnapshotId: string | null = null;
  private isPanelOpen = false;
  private observedElement: HTMLElement | null = null;
  private positionFrame: number | null = null;

  private readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly buttonTitle = document.createElement('span');
  private readonly buttonMeta = document.createElement('span');
  private readonly panel = document.createElement('aside');
  private readonly headerTitle = document.createElement('div');
  private readonly headerMeta = document.createElement('div');
  private readonly snapshotNowButton = document.createElement('button');
  private readonly versionsList = document.createElement('div');
  private readonly previewSummary = document.createElement('div');
  private readonly previewDiff = document.createElement('div');
  private readonly restoreButton = document.createElement('button');
  private readonly emptyState = document.createElement('div');
  private readonly resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => this.schedulePositionUpdate())
    : null;

  init() {
    this.buildUi();
    this.attachExistingEditables();
    this.observeDom();

    document.addEventListener('focusin', this.handleFocusIn, true);
    document.addEventListener('scroll', this.handleViewportChange, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('visibilitychange', this.handleVisibilityChange, true);
    window.addEventListener('resize', this.handleViewportChange, true);
    window.addEventListener('pagehide', this.handlePageHide, true);

    const active = findHistoryEditable(document.activeElement);
    if (active) {
      this.activateElement(active);
    } else {
      this.renderButton();
    }
  }

  private buildUi() {
    this.root.className = 'stet-history-root';

    this.button.className = 'stet-history-button';
    this.button.type = 'button';
    this.button.addEventListener('click', () => {
      if (this.isPanelOpen) {
        this.closePanel();
      } else {
        void this.openPanel();
      }
    });

    this.buttonTitle.className = 'stet-history-button-title';
    this.buttonTitle.textContent = 'Version history';
    this.buttonMeta.className = 'stet-history-button-meta';

    this.button.append(this.buttonTitle, this.buttonMeta);

    this.panel.className = 'stet-history-panel';
    this.panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'stet-history-panel-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'stet-history-panel-title-group';

    const heading = document.createElement('h2');
    heading.className = 'stet-history-panel-title';
    heading.textContent = 'Version history';

    this.headerTitle.className = 'stet-history-panel-target';
    this.headerMeta.className = 'stet-history-panel-subtitle';

    titleGroup.append(heading, this.headerTitle, this.headerMeta);

    const closeButton = document.createElement('button');
    closeButton.className = 'stet-history-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.closePanel());

    header.append(titleGroup, closeButton);

    const actions = document.createElement('div');
    actions.className = 'stet-history-actions';

    this.snapshotNowButton.className = 'stet-history-secondary-btn';
    this.snapshotNowButton.type = 'button';
    this.snapshotNowButton.textContent = 'Snapshot now';
    this.snapshotNowButton.addEventListener('click', () => {
      void this.captureManualSnapshot();
    });

    actions.append(this.snapshotNowButton);

    const listSection = document.createElement('section');
    listSection.className = 'stet-history-section';

    const listHeading = document.createElement('div');
    listHeading.className = 'stet-history-section-heading';
    listHeading.textContent = 'Saved versions';

    this.versionsList.className = 'stet-history-list';
    this.versionsList.addEventListener('click', (event) => {
      const trigger = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-snapshot-id]');
      const snapshotId = trigger?.dataset.snapshotId;
      if (!snapshotId) return;
      this.selectedSnapshotId = snapshotId;
      this.renderPanel();
    });

    this.emptyState.className = 'stet-history-empty';
    this.emptyState.textContent = 'Start typing and Stet will save local drafts every few seconds. Older history collapses to bigger milestones.';

    listSection.append(listHeading, this.versionsList, this.emptyState);

    const previewSection = document.createElement('section');
    previewSection.className = 'stet-history-section stet-history-preview';

    const previewHeading = document.createElement('div');
    previewHeading.className = 'stet-history-section-heading';
    previewHeading.textContent = 'Compare with current draft';

    this.previewSummary.className = 'stet-history-preview-summary';
    this.previewDiff.className = 'stet-history-diff';

    this.restoreButton.className = 'stet-history-primary-btn';
    this.restoreButton.type = 'button';
    this.restoreButton.textContent = 'Restore selected version';
    this.restoreButton.addEventListener('click', () => {
      void this.restoreSelectedSnapshot();
    });

    previewSection.append(previewHeading, this.previewSummary, this.previewDiff, this.restoreButton);

    this.panel.append(header, actions, listSection, previewSection);
    this.root.append(this.button, this.panel);

    (document.body ?? document.documentElement).appendChild(this.root);
  }

  private attachExistingEditables() {
    discoverHistoryEditables().forEach((element) => this.attachEditable(element));
  }

  private attachEditable(element: HTMLElement) {
    if (this.sessions.has(element)) return;

    const target = getEditableTarget(element);
    if (!target) return;

    const session = new HistorySession(target, () => {
      if (this.activeSession === session) {
        this.renderButton();
        if (this.isPanelOpen) this.renderPanel();
      }
    });

    this.sessions.set(element, session);
  }

  private activateElement(element: HTMLElement) {
    this.attachEditable(element);
    const session = this.sessions.get(element);
    if (!session) return;

    this.activeSession = session;
    this.observeActiveElement(element);
    void session.ensureLoaded().then(() => {
      if (this.activeSession !== session) return;
      this.ensureSelectedSnapshot();
      this.renderButton();
      if (this.isPanelOpen) this.renderPanel();
    });

    this.ensureSelectedSnapshot();
    this.renderButton();
  }

  private async openPanel() {
    if (!this.activeSession) return;

    this.isPanelOpen = true;
    this.panel.hidden = false;

    await this.activeSession.ensureLoaded();
    this.ensureSelectedSnapshot(true);
    this.renderPanel();
  }

  private closePanel() {
    this.isPanelOpen = false;
    this.panel.hidden = true;
    this.schedulePositionUpdate();
  }

  private ensureSelectedSnapshot(force = false) {
    if (!this.activeSession) {
      this.selectedSnapshotId = null;
      return;
    }

    const snapshots = this.activeSession.record?.snapshots ?? [];
    if (snapshots.length === 0) {
      this.selectedSnapshotId = null;
      return;
    }

    if (!force && this.selectedSnapshotId && snapshots.some((snapshot) => snapshot.id === this.selectedSnapshotId)) {
      return;
    }

    const currentText = this.activeSession.target.read();
    const latest = snapshots.at(-1);
    const fallback = snapshots.at(-2) ?? latest;
    this.selectedSnapshotId = latest && latest.content === currentText ? fallback?.id ?? null : latest?.id ?? null;
  }

  private renderButton() {
    const session = this.activeSession;
    const hasActiveElement = session?.target.element.isConnected ?? false;

    this.root.hidden = !hasActiveElement;
    this.button.hidden = !hasActiveElement;
    if (!hasActiveElement || !session) return;

    const versions = session.record?.snapshots ?? [];
    const latest = versions.at(-1);

    this.buttonTitle.textContent = 'Autosaved draft';
    this.buttonMeta.textContent = latest
      ? `${session.target.label} · ${versions.length} version${versions.length === 1 ? '' : 's'} · ${formatRelativeTime(latest.savedAt)}`
      : `${session.target.label} · No local versions yet`;

    this.button.setAttribute('aria-label', `Version history for ${session.target.label}`);
    this.schedulePositionUpdate();
  }

  private renderPanel() {
    const session = this.activeSession;
    if (!session) {
      this.closePanel();
      return;
    }

    const record = session.record;
    const snapshots = record?.snapshots ?? [];
    const selected = snapshots.find((snapshot) => snapshot.id === this.selectedSnapshotId) ?? null;

    this.headerTitle.textContent = session.target.label;
    this.headerMeta.textContent = 'Restore replaces the full contents of this editor.';
    this.emptyState.hidden = snapshots.length > 0;
    this.versionsList.innerHTML = '';

    for (const snapshot of [...snapshots].reverse()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `stet-history-list-item${snapshot.id === selected?.id ? ' is-selected' : ''}`;
      item.dataset.snapshotId = snapshot.id;

      const lineOne = document.createElement('span');
      lineOne.className = 'stet-history-list-line';
      lineOne.textContent = formatVersionLabel(snapshot);

      const lineTwo = document.createElement('span');
      lineTwo.className = 'stet-history-list-line stet-history-list-meta';
      lineTwo.textContent = `${formatAbsoluteDate(snapshot.savedAt)} · ${snapshot.charCount.toLocaleString()} chars`;

      item.append(lineOne, lineTwo);
      this.versionsList.appendChild(item);
    }

    if (!selected) {
      this.previewSummary.textContent = 'Pick a saved version to preview the full restore diff.';
      this.previewDiff.innerHTML = '';
      this.restoreButton.disabled = true;
      this.schedulePositionUpdate();
      return;
    }

    const currentText = session.target.read();
    const diff = diffText(currentText, selected.content);
    const unchanged = diff.addedChars === 0 && diff.removedChars === 0;

    this.previewSummary.textContent = unchanged
      ? 'Selected version matches the current draft.'
      : `Restoring this version will add ${diff.addedChars.toLocaleString()} chars and remove ${diff.removedChars.toLocaleString()} chars.`;

    this.previewDiff.innerHTML = renderDiffHtml(diff.chunks);
    this.restoreButton.disabled = unchanged;
    this.schedulePositionUpdate();
  }

  private async captureManualSnapshot() {
    if (!this.activeSession) return;
    await this.activeSession.persist('manual', true);
    this.ensureSelectedSnapshot(true);
    this.renderPanel();
  }

  private async restoreSelectedSnapshot() {
    const session = this.activeSession;
    if (!session) return;

    const snapshot = session.record?.snapshots.find((entry) => entry.id === this.selectedSnapshotId);
    if (!snapshot) return;

    const currentText = session.target.read();
    if (currentText === snapshot.content) return;

    const ok = window.confirm('Replace the entire editor contents with the selected saved version?');
    if (!ok) return;

    session.target.write(snapshot.content);
    await session.persist('restore', true);
    this.ensureSelectedSnapshot(true);
    this.renderPanel();
  }

  private observeActiveElement(element: HTMLElement | null) {
    if (this.observedElement === element) return;

    if (this.resizeObserver && this.observedElement) {
      this.resizeObserver.unobserve(this.observedElement);
    }

    this.observedElement = element;

    if (this.resizeObserver && element) {
      this.resizeObserver.observe(element);
    }
  }

  private schedulePositionUpdate() {
    if (this.positionFrame !== null) return;

    this.positionFrame = window.requestAnimationFrame(() => {
      this.positionFrame = null;
      this.positionUi();
    });
  }

  private positionUi() {
    const session = this.activeSession;
    const element = session?.target.element;
    if (!element?.isConnected || this.button.hidden) return;

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const edge = VersionHistoryManager.EDGE_MARGIN;
    const gap = VersionHistoryManager.GAP;

    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom < edge ||
      rect.top > viewportHeight - edge ||
      rect.right < edge ||
      rect.left > viewportWidth - edge
    ) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;

    const buttonWidth = Math.min(
      this.button.offsetWidth || VersionHistoryManager.FALLBACK_BUTTON_WIDTH,
      Math.max(160, viewportWidth - edge * 2),
    );
    const buttonHeight = this.button.offsetHeight || VersionHistoryManager.FALLBACK_BUTTON_HEIGHT;
    const buttonLeft = clamp(
      rect.right - buttonWidth,
      edge,
      Math.max(edge, viewportWidth - buttonWidth - edge),
    );
    const buttonTop = placeNearRect(rect, buttonHeight, viewportHeight, edge, gap);

    this.button.style.left = `${buttonLeft}px`;
    this.button.style.top = `${buttonTop}px`;

    if (!this.isPanelOpen || this.panel.hidden) return;

    const panelWidth = Math.min(
      this.panel.offsetWidth || VersionHistoryManager.FALLBACK_PANEL_WIDTH,
      Math.max(260, viewportWidth - edge * 2),
    );
    const panelHeight = Math.min(
      this.panel.offsetHeight || VersionHistoryManager.FALLBACK_PANEL_HEIGHT,
      Math.max(220, viewportHeight - edge * 2),
    );
    const panelLeft = clamp(
      rect.right - panelWidth,
      edge,
      Math.max(edge, viewportWidth - panelWidth - edge),
    );

    let panelTop = buttonTop + buttonHeight + gap;
    if (panelTop + panelHeight > viewportHeight - edge) {
      const aboveButtonTop = buttonTop - panelHeight - gap;
      if (aboveButtonTop >= edge) {
        panelTop = aboveButtonTop;
      } else {
        panelTop = clamp(rect.top + gap, edge, Math.max(edge, viewportHeight - panelHeight - edge));
      }
    }

    this.panel.style.left = `${panelLeft}px`;
    this.panel.style.top = `${panelTop}px`;
  }

  private observeDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          discoverHistoryEditables(node).forEach((element) => this.attachEditable(element));
        });

        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          this.detachEditablesInSubtree(node);
        });
      }

      this.pruneDisconnectedSessions();
    });

    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private detachEditablesInSubtree(root: HTMLElement) {
    for (const [element, session] of this.sessions) {
      if (element === root || root.contains(element)) {
        session.destroy();
        this.sessions.delete(element);
        if (this.activeSession === session) {
          this.activeSession = null;
          this.selectedSnapshotId = null;
          this.observeActiveElement(null);
          this.closePanel();
          this.renderButton();
        }
      }
    }
  }

  private pruneDisconnectedSessions() {
    for (const [element, session] of this.sessions) {
      if (element.isConnected) continue;
      session.destroy();
      this.sessions.delete(element);
      if (this.activeSession === session) {
        this.activeSession = null;
        this.selectedSnapshotId = null;
        this.observeActiveElement(null);
      }
    }

    this.renderButton();
  }

  private readonly handleFocusIn = (event: FocusEvent) => {
    const editable = findHistoryEditable(event.target);
    if (!editable) return;
    this.activateElement(editable);
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isPanelOpen) {
      this.closePanel();
    }
  };

  private readonly handleVisibilityChange = () => {
    if (!document.hidden) return;
    void this.flushAllSessions();
  };

  private readonly handleViewportChange = () => {
    this.schedulePositionUpdate();
  };

  private readonly handlePageHide = () => {
    void this.flushAllSessions();
  };

  private async flushAllSessions() {
    await Promise.all([...this.sessions.values()].map((session) => session.flushPending()));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function placeNearRect(
  rect: DOMRect,
  overlayHeight: number,
  viewportHeight: number,
  edge: number,
  gap: number,
): number {
  const preferredAbove = rect.top - overlayHeight - gap;
  if (preferredAbove >= edge) return preferredAbove;

  const preferredBelow = rect.bottom + gap;
  if (preferredBelow + overlayHeight <= viewportHeight - edge) return preferredBelow;

  return clamp(preferredBelow, edge, Math.max(edge, viewportHeight - overlayHeight - edge));
}

function renderDiffHtml(chunks: ReturnType<typeof diffText>['chunks']): string {
  if (chunks.length === 0) {
    return '<p class="stet-history-preview-note">No textual differences.</p>';
  }

  return chunks.map((chunk) => {
    const value = escapeHtml(chunk.value).replace(/\n/g, '<br>');
    if (chunk.type === 'equal') return `<span>${value}</span>`;
    if (chunk.type === 'insert') return `<ins class="stet-history-insert">${value}</ins>`;
    return `<del class="stet-history-delete">${value}</del>`;
  }).join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatVersionLabel(snapshot: VersionSnapshot): string {
  const source = snapshot.source === 'manual'
    ? 'Manual snapshot'
    : snapshot.source === 'restore'
      ? 'Restore point'
      : 'Autosave';

  const milestone = snapshot.isMilestone ? ' · milestone' : '';
  return `${source}${milestone} · ${formatRelativeTime(snapshot.savedAt)}`;
}

function formatRelativeTime(dateString: string): string {
  const deltaMs = Date.now() - Date.parse(dateString);
  if (!Number.isFinite(deltaMs)) return 'just now';

  const minutes = Math.round(deltaMs / 60000);
  if (minutes <= 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
