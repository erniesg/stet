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
  verifyRestoredContent,
} from './version-history-core.js';
import { loadHistoryRecordForTarget, saveSnapshotForTarget } from './version-history-store.js';
import {
  flushHistoryEventRates,
  getElapsedMs,
  getHistoryTargetLogData,
  getNow,
  isHistoryDebugEnabled,
  isHistoryRuntimeDisabled,
  logHistoryEvent,
  recordHistoryEventRate,
} from './version-history-debug.js';
import { computeFieldHistoryLayout } from './version-history-layout.js';
import {
  resolveHistoryRuntimeConfig,
  type HistoryRuntimeConfig,
  type HistoryUiMode,
} from '../history-settings.js';

class HistorySession {
  public record: EditableHistoryRecord | null = null;

  private loadPromise: Promise<EditableHistoryRecord | null> | null = null;
  private writeChain: Promise<EditableHistoryRecord | null> = Promise.resolve(null);
  private saveTimer: number | null = null;
  private readonly handleInputBound: () => void;
  private readonly handleBlurBound: () => void;

  constructor(
    public readonly target: EditableTarget,
    private readonly debug: boolean,
    private readonly onChange: () => void,
  ) {
    this.handleInputBound = () => {
      recordHistoryEventRate('input', { fieldKey: this.target.fieldKey }, this.debug);
      void this.ensureLoaded();
      this.scheduleAutosave();
    };
    this.handleBlurBound = () => {
      recordHistoryEventRate('blur', { fieldKey: this.target.fieldKey }, this.debug);
      void this.persist('blur', true);
    };

    this.target.element.addEventListener('input', this.handleInputBound);
    this.target.element.addEventListener('blur', this.handleBlurBound, true);
  }

  async ensureLoaded(): Promise<EditableHistoryRecord | null> {
    if (this.record) return this.record;
    if (!this.loadPromise) {
      this.loadPromise = loadHistoryRecordForTarget(this.target, this.debug)
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
        this.debug,
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
  void loadHistoryRuntime().then((runtime) => {
    logHistoryEvent('history:init', {
      enabled: runtime.enabled,
      requestedUiMode: runtime.requestedUiMode,
      allowAnchoredUi: runtime.allowAnchoredUi,
      reason: runtime.reason,
    }, { debug: runtime.debug });

    if (!runtime.enabled) return;

    const manager = new VersionHistoryManager(runtime);
    manager.init();
  });
}

class VersionHistoryManager {
  constructor(private readonly runtime: HistoryRuntimeConfig) {}

  private readonly sessions = new Map<HTMLElement, HistorySession>();
  private activeSession: HistorySession | null = null;
  private selectedSnapshotId: string | null = null;
  private isPanelOpen = false;

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
  private repositionFrame: number | null = null;
  private pendingPositionSource: string | null = null;

  init() {
    if (this.runtime.requestedUiMode === 'field' && !this.isFieldMode) {
      logHistoryEvent('history:mode-fallback', {
        allowAnchoredUi: this.runtime.allowAnchoredUi,
        reason: this.runtime.reason ?? 'field-ui-host-blocked',
      }, { debug: this.runtime.debug });
    }

    this.buildUi();
    this.attachExistingEditables();
    this.observeDom();

    document.addEventListener('focusin', this.handleFocusIn, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('visibilitychange', this.handleVisibilityChange, true);
    window.addEventListener('pagehide', this.handlePageHide, true);
    if (this.isFieldMode) {
      window.addEventListener('resize', this.handleViewportShift, true);
      window.addEventListener('scroll', this.handleViewportShift, true);
    }

    const active = findHistoryEditable(document.activeElement);
    if (active) {
      this.activateElement(active, 'init');
    } else {
      this.renderButton();
    }
  }

  private buildUi() {
    this.root.className = `stet-history-root${this.isFieldMode ? ' is-field-mode' : ''}`;

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
    this.buttonTitle.textContent = this.isFieldMode ? 'History' : 'Version history';
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

    logHistoryEvent('history:mount', {}, { debug: this.runtime.debug });
    this.updateFloatingPosition('mount', true);
  }

  private attachExistingEditables() {
    discoverHistoryEditables().forEach((element) => this.attachEditable(element, 'initial-scan'));
  }

  private attachEditable(element: HTMLElement, source: string) {
    if (this.sessions.has(element)) return;

    const target = getEditableTarget(element);
    if (!target) return;

    const session = new HistorySession(target, this.runtime.debug, () => {
      if (this.activeSession === session) {
        this.renderButton();
        if (this.isPanelOpen) this.renderPanel();
      }
    });

    this.sessions.set(element, session);
    logHistoryEvent('history:bind', {
      ...getHistoryTargetLogData(target),
      source,
    }, { debug: this.runtime.debug });
  }

  private activateElement(element: HTMLElement, source: string) {
    this.attachEditable(element, source);
    const session = this.sessions.get(element);
    if (!session) return;

    this.activeSession = session;
    logHistoryEvent('history:activate', {
      ...getHistoryTargetLogData(session.target),
      source,
    }, { debug: this.runtime.debug });

    void session.ensureLoaded().then(() => {
      if (this.activeSession !== session) return;
      this.ensureSelectedSnapshot();
      this.renderButton();
      if (this.isPanelOpen) this.renderPanel();
    });

    this.ensureSelectedSnapshot();
    this.renderButton();
    this.updateFloatingPosition(source, true);
  }

  private async openPanel() {
    if (!this.activeSession) return;

    this.isPanelOpen = true;
    this.panel.hidden = false;
    this.updateFloatingPosition('open-pending');

    await this.activeSession.ensureLoaded();
    this.ensureSelectedSnapshot(true);
    this.renderPanel();
    logHistoryEvent('history:open', {
      ...getHistoryTargetLogData(this.activeSession.target),
    }, { debug: this.runtime.debug });
    this.updateFloatingPosition('open', true);
  }

  private closePanel() {
    this.isPanelOpen = false;
    this.panel.hidden = true;
    logHistoryEvent('history:close', {}, { debug: this.runtime.debug });
    this.updateFloatingPosition('close', true);
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

    this.button.hidden = !hasActiveElement;
    if (!hasActiveElement || !session) {
      this.updateFloatingPosition('render-button');
      return;
    }

    const versions = session.record?.snapshots ?? [];
    const latest = versions.at(-1);

    this.buttonMeta.textContent = latest
      ? `${versions.length} version${versions.length === 1 ? '' : 's'} · ${formatRelativeTime(latest.savedAt)}`
      : 'No local versions yet';

    this.updateFloatingPosition('render-button');
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
    this.headerMeta.textContent = session.target.descriptor;
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
      this.updateFloatingPosition('render-panel');
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
    this.updateFloatingPosition('render-panel');
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

    const startedAt = getNow();
    session.target.write(snapshot.content);
    const verification = verifyRestoredContent(snapshot.content, session.target.read());
    logHistoryEvent('history:restore', {
      ...getHistoryTargetLogData(session.target),
      snapshotId: snapshot.id,
      ...verification,
      elapsedMs: getElapsedMs(startedAt),
    }, {
      debug: this.runtime.debug,
      level: verification.ok ? 'debug' : 'warn',
    });

    if (!verification.ok) {
      this.previewSummary.textContent = 'Restore could not be verified on this editor. Stet did not save a restore point.';
      return;
    }

    await session.persist('restore', true);
    this.ensureSelectedSnapshot(true);
    this.renderPanel();
  }

  private observeDom() {
    const observer = new MutationObserver((mutations) => {
      recordHistoryEventRate('mutation', {
        mutationCount: mutations.length,
      }, this.runtime.debug);

      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          discoverHistoryEditables(node).forEach((element) => this.attachEditable(element, 'mutation'));
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
        logHistoryEvent('history:unbind', {
          ...getHistoryTargetLogData(session.target),
          reason: 'dom-remove',
        }, { debug: this.runtime.debug });
        if (this.activeSession === session) {
          this.activeSession = null;
          this.selectedSnapshotId = null;
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
      logHistoryEvent('history:unbind', {
        ...getHistoryTargetLogData(session.target),
        reason: 'disconnect',
      }, { debug: this.runtime.debug });
      if (this.activeSession === session) {
        this.activeSession = null;
        this.selectedSnapshotId = null;
      }
    }

    this.renderButton();
  }

  private readonly handleFocusIn = (event: FocusEvent) => {
    recordHistoryEventRate('focusin', {}, this.runtime.debug);
    const editable = findHistoryEditable(event.target);
    if (!editable) return;
    this.activateElement(editable, 'focusin');
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

  private readonly handlePageHide = () => {
    void this.flushAllSessions();
  };

  private readonly handleViewportShift = () => {
    recordHistoryEventRate('viewport', { open: this.isPanelOpen }, this.runtime.debug);
    this.scheduleFloatingPosition('viewport');
  };

  private async flushAllSessions() {
    const startedAt = getNow();
    await Promise.all([...this.sessions.values()].map((session) => session.flushPending()));
    flushHistoryEventRates(this.runtime.debug);
    logHistoryEvent('history:flush', {
      sessionCount: this.sessions.size,
      elapsedMs: getElapsedMs(startedAt),
    }, { debug: this.runtime.debug });
  }

  private scheduleFloatingPosition(source: string) {
    if (!this.isFieldMode) return;

    this.pendingPositionSource = source;
    if (this.repositionFrame !== null) return;

    this.repositionFrame = window.requestAnimationFrame(() => {
      const nextSource = this.pendingPositionSource ?? 'viewport';
      this.pendingPositionSource = null;
      this.repositionFrame = null;
      this.updateFloatingPosition(nextSource);
    });
  }

  private updateFloatingPosition(source: string, log = false) {
    if (!this.isFieldMode) {
      this.clearFloatingStyles();
      if (log) this.logPosition(source);
      return;
    }

    const session = this.activeSession;
    if (!session || !session.target.element.isConnected) {
      this.button.hidden = true;
      this.panel.hidden = true;
      if (log) this.logPosition(source);
      return;
    }

    const targetRect = session.target.element.getBoundingClientRect();
    const layout = computeFieldHistoryLayout({
      targetRect: {
        top: targetRect.top,
        left: targetRect.left,
        width: targetRect.width,
        height: targetRect.height,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      chipWidth: this.button.offsetWidth || 164,
      chipHeight: this.button.offsetHeight || 44,
      panelWidth: this.panel.offsetWidth || 420,
      panelHeight: this.panel.hidden ? 420 : (this.panel.offsetHeight || 420),
      panelOpen: this.isPanelOpen,
    });

    if (!layout.visible) {
      this.button.hidden = true;
      this.panel.hidden = true;
      if (log) this.logPosition(source);
      return;
    }

    this.button.hidden = false;
    this.button.style.left = `${layout.chip.left}px`;
    this.button.style.top = `${layout.chip.top}px`;
    this.button.style.width = `${layout.chip.width}px`;

    this.panel.hidden = !this.isPanelOpen;
    this.panel.style.left = `${layout.panel.left}px`;
    this.panel.style.top = `${layout.panel.top}px`;
    this.panel.style.width = `${layout.panel.width}px`;
    this.panel.dataset.placement = layout.panel.placement;

    if (log) this.logPosition(source);
  }

  private clearFloatingStyles() {
    this.button.style.left = '';
    this.button.style.top = '';
    this.button.style.width = '';
    this.panel.style.left = '';
    this.panel.style.top = '';
    this.panel.style.width = '';
    delete this.panel.dataset.placement;
  }

  private logPosition(source: string) {
    const buttonRect = this.button.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();

    logHistoryEvent('history:position', {
      source,
      uiMode: this.isFieldMode ? 'field' : 'page',
      target: this.activeSession
        ? getHistoryTargetLogData(this.activeSession.target).rect
        : null,
      button: {
        top: Math.round(buttonRect.top * 10) / 10,
        left: Math.round(buttonRect.left * 10) / 10,
        width: Math.round(buttonRect.width * 10) / 10,
        height: Math.round(buttonRect.height * 10) / 10,
        hidden: this.button.hidden,
      },
      panel: {
        top: Math.round(panelRect.top * 10) / 10,
        left: Math.round(panelRect.left * 10) / 10,
        width: Math.round(panelRect.width * 10) / 10,
        height: Math.round(panelRect.height * 10) / 10,
        hidden: this.panel.hidden,
        placement: this.panel.dataset.placement ?? 'below',
      },
    }, { debug: this.runtime.debug });
  }

  private get isFieldMode(): boolean {
    return this.runtime.requestedUiMode === 'field' && this.runtime.allowAnchoredUi;
  }
}

async function loadHistoryRuntime(): Promise<HistoryRuntimeConfig> {
  const settings = await new Promise<unknown>((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_HISTORY_SETTINGS' }, (resp) => {
      resolve(resp?.history ?? null);
    });
  }).catch(() => null);

  return resolveHistoryRuntimeConfig(
    settings as Record<string, unknown> | null,
    { hostname: window.location.hostname },
    {
      disableHistory: isHistoryRuntimeDisabled(),
      debug: isHistoryDebugEnabled(false),
      uiModeOverride: readHistoryUiModeOverride(),
    },
  );
}

function readHistoryUiModeOverride(): HistoryUiMode | undefined {
  const queryOverride = new URLSearchParams(window.location.search).get('stetHistoryUi');
  if (queryOverride === 'off' || queryOverride === 'page' || queryOverride === 'field') {
    return queryOverride;
  }

  const windowOverride = window.__stetHistoryUiMode;
  if (windowOverride === 'off' || windowOverride === 'page' || windowOverride === 'field') {
    return windowOverride;
  }

  return undefined;
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
