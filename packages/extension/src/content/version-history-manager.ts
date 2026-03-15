import {
  findHistoryEditable,
  getEditableTarget,
  type EditableTarget,
} from './editable-target.js';
import { diffText, type DiffChunk } from './version-history-diff.js';
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
  getHistoryErrorLogData,
  getHistoryTargetLogData,
  getNow,
  isHistoryDebugEnabled,
  isHistoryRuntimeDisabled,
  logHistoryEvent,
  recordHistoryEventRate,
} from './version-history-debug.js';
import {
  computeFieldHistoryLayout,
  type HistoryLayoutRect,
} from './version-history-layout.js';
import {
  resolveHistoryRuntimeConfig,
  type HistoryRuntimeConfig,
  type HistoryUiMode,
} from '../history-settings.js';
import { setManagedVisibility } from './ui-visibility.js';

class HistorySession {
  public record: EditableHistoryRecord | null = null;

  private loadPromise: Promise<EditableHistoryRecord | null> | null = null;
  private loaded = false;
  private writeChain: Promise<EditableHistoryRecord | null> = Promise.resolve(null);
  private saveTimer: number | null = null;
  private readonly handleInputBound: () => void;
  private readonly handleBlurBound: () => void;

  constructor(
    public readonly target: EditableTarget,
    private readonly debug: boolean,
    private readonly onChange: () => void,
    private readonly onError: (error: unknown) => void,
  ) {
    this.handleInputBound = () => {
      this.noteInput();
    };
    this.handleBlurBound = () => {
      this.noteBlur();
    };

    this.target.element.addEventListener('input', this.handleInputBound);
    this.target.element.addEventListener('blur', this.handleBlurBound, true);
  }

  async ensureLoaded(): Promise<EditableHistoryRecord | null> {
    if (this.loaded) return this.record;
    if (!this.loadPromise) {
      this.loadPromise = loadHistoryRecordForTarget(this.target, this.debug)
        .then((record) => {
          this.record = record;
          this.loaded = true;
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

  noteInput() {
    recordHistoryEventRate('input', { fieldKey: this.target.fieldKey }, this.debug);
    void this.ensureLoaded().catch(this.onError);
    this.scheduleAutosave();
  }

  noteBlur() {
    recordHistoryEventRate('blur', { fieldKey: this.target.fieldKey }, this.debug);
    void this.persist('blur', true).catch(this.onError);
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
      void this.persist('autosave').catch(this.onError);
    }, DEFAULT_HISTORY_POLICY.debounceMs);

    this.onChange();
  }
}

let historyManager: VersionHistoryManager | null = null;

export function initVersionHistory() {
  if (historyManager) {
    logHistoryEvent('history:init-skip', {
      reason: 'duplicate-manager',
    }, {
      debug: isHistoryDebugEnabled(false),
      level: 'warn',
    });
    return;
  }

  void loadHistoryRuntime()
    .then((runtime) => {
      logHistoryEvent('history:init', {
        enabled: runtime.enabled,
        requestedUiMode: runtime.requestedUiMode,
        allowAnchoredUi: runtime.allowAnchoredUi,
        reason: runtime.reason,
      }, { debug: runtime.debug });

      if (!runtime.enabled) return;

      const manager = new VersionHistoryManager(runtime);
      historyManager = manager;
      manager.init();
    })
    .catch((error) => {
      historyManager = null;
      logHistoryEvent('history:error', {
        source: 'init-version-history',
        ...getHistoryErrorLogData(error),
      }, {
        debug: isHistoryDebugEnabled(false),
        level: 'warn',
      });
    });
}

export class VersionHistoryManager {
  constructor(private readonly runtime: HistoryRuntimeConfig) {}

  private activeSession: HistorySession | null = null;
  private selectedSnapshotId: string | null = null;
  private isPanelOpen = false;
  private observer: MutationObserver | null = null;
  private hasFatalError = false;

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
  private obstacleCache: HistoryLayoutRect[] | null = null;
  private obstacleCacheTime = 0;
  private static readonly OBSTACLE_CACHE_TTL_MS = 500;

  init() {
    this.runGuarded('init', () => {
      if (this.runtime.requestedUiMode === 'field' && !this.isFieldMode) {
        logHistoryEvent('history:mode-fallback', {
          allowAnchoredUi: this.runtime.allowAnchoredUi,
          reason: this.runtime.reason ?? 'field-ui-host-blocked',
        }, { debug: this.runtime.debug });
      }

      if (this.showUi) {
        this.buildUi();
      }
      this.observeDom();

      document.addEventListener('focusin', this.handleFocusIn, true);
      document.addEventListener('focusout', this.handleFocusOut, true);
      document.addEventListener('input', this.handleInput, true);
      if (this.showUi) {
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('pointerdown', this.handlePointerDown, true);
      }
      document.addEventListener('visibilitychange', this.handleVisibilityChange, true);
      window.addEventListener('pagehide', this.handlePageHide, true);
      if (this.isFieldMode) {
        window.addEventListener('resize', this.handleViewportShift, true);
        window.addEventListener('scroll', this.handleViewportShift, true);
      }

      const active = getInitialHistoryEditable(document.activeElement);
      if (active) {
        this.activateElement(active, 'init');
      } else {
        this.renderButton();
      }
    });
  }

  destroy() {
    document.removeEventListener('focusin', this.handleFocusIn, true);
    document.removeEventListener('focusout', this.handleFocusOut, true);
    document.removeEventListener('input', this.handleInput, true);
    if (this.showUi) {
      document.removeEventListener('keydown', this.handleKeyDown, true);
      document.removeEventListener('pointerdown', this.handlePointerDown, true);
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange, true);
    window.removeEventListener('pagehide', this.handlePageHide, true);
    if (this.isFieldMode) {
      window.removeEventListener('resize', this.handleViewportShift, true);
      window.removeEventListener('scroll', this.handleViewportShift, true);
    }

    this.observer?.disconnect();
    this.observer = null;

    if (this.repositionFrame !== null) {
      window.cancelAnimationFrame(this.repositionFrame);
      this.repositionFrame = null;
      this.pendingPositionSource = null;
    }

    this.releaseActiveSession('destroy', { clearUi: true, closePanel: false });
    if (this.showUi) {
      this.root.remove();
    }
    if (historyManager === this) {
      historyManager = null;
    }
  }

  private runGuarded(source: string, fn: () => void) {
    if (this.hasFatalError) return;

    try {
      fn();
    } catch (error) {
      this.handleFatalError(source, error);
    }
  }

  private runAsyncGuarded(source: string, fn: () => Promise<void>) {
    if (this.hasFatalError) return;

    try {
      void fn().catch((error) => {
        this.handleFatalError(source, error);
      });
    } catch (error) {
      this.handleFatalError(source, error);
    }
  }

  private handleFatalError(source: string, error: unknown) {
    if (this.hasFatalError) return;
    this.hasFatalError = true;

    logHistoryEvent('history:error', {
      source,
      activeFieldKey: this.activeSession?.target.fieldKey ?? null,
      panelOpen: this.isPanelOpen,
      uiMode: this.isFieldMode ? 'field' : 'page',
      ...getHistoryErrorLogData(error),
    }, {
      debug: true,
      level: 'warn',
    });

    try {
      this.destroy();
    } catch (destroyError) {
      logHistoryEvent('history:error', {
        source: 'fatal-destroy',
        ...getHistoryErrorLogData(destroyError),
      }, {
        debug: true,
        level: 'warn',
      });
    }
  }

  private buildUi() {
    this.root.className = `stet-history-root${this.isFieldMode ? ' is-field-mode' : ''}`;

    this.button.className = 'stet-history-button';
    this.button.type = 'button';
    this.button.addEventListener('click', () => {
      this.runAsyncGuarded('button-click', async () => {
        if (this.isPanelOpen) {
          this.closePanel();
        } else {
          await this.openPanel();
        }
      });
    });

    this.buttonTitle.className = 'stet-history-button-title';
    this.buttonTitle.textContent = this.isFieldMode ? 'History' : 'Version history';
    this.buttonMeta.className = 'stet-history-button-meta';

    this.button.append(this.buttonTitle, this.buttonMeta);

    this.panel.className = 'stet-history-panel';

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
    closeButton.addEventListener('click', () => {
      this.runGuarded('close-click', () => {
        if (this.isFieldMode) {
          this.closePanel();
          return;
        }

        this.releaseActiveSession('manual-close', { clearUi: true, closePanel: true });
      });
    });

    header.append(titleGroup, closeButton);

    const actions = document.createElement('div');
    actions.className = 'stet-history-actions';

    this.snapshotNowButton.className = 'stet-history-secondary-btn';
    this.snapshotNowButton.type = 'button';
    this.snapshotNowButton.textContent = 'Snapshot now';
    this.snapshotNowButton.addEventListener('click', () => {
      this.runAsyncGuarded('snapshot-click', async () => {
        await this.captureManualSnapshot();
      });
    });

    actions.append(this.snapshotNowButton);

    const listSection = document.createElement('section');
    listSection.className = 'stet-history-section';

    const listHeading = document.createElement('div');
    listHeading.className = 'stet-history-section-heading';
    listHeading.textContent = 'Saved versions';

    this.versionsList.className = 'stet-history-list';
    this.versionsList.addEventListener('click', (event) => {
      this.runGuarded('list-click', () => {
        const trigger = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-snapshot-id]');
        const snapshotId = trigger?.dataset.snapshotId;
        if (!snapshotId) return;
        this.selectedSnapshotId = snapshotId;
        trigger.blur();
        this.renderPanel();
      });
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
      this.runAsyncGuarded('restore-click', async () => {
        await this.restoreSelectedSnapshot();
      });
    });

    previewSection.append(previewHeading, this.previewSummary, this.previewDiff, this.restoreButton);

    this.panel.append(header, actions, listSection, previewSection);
    this.root.append(this.button, this.panel);

    (document.body ?? document.documentElement).appendChild(this.root);
    setManagedVisibility(this.root, false, 'flex');
    setManagedVisibility(this.button, false, 'flex');
    setManagedVisibility(this.panel, false, 'flex');

    logHistoryEvent('history:mount', {}, { debug: this.runtime.debug });
    this.updateFloatingPosition('mount', true);
  }

  private activateElement(element: HTMLElement, source: string): HistorySession | null {
    const target = getEditableTarget(element);
    if (!target) return null;

    const current = this.activeSession;
    if (current?.target.element === element) {
      logHistoryEvent('history:activate', {
        ...getHistoryTargetLogData(current.target),
        source,
        retained: true,
      }, { debug: this.runtime.debug });
      this.ensureSelectedSnapshot();
      this.renderButton();
      this.updateFloatingPosition(source, true);
      return current;
    }

    this.releaseActiveSession(
      current && current.target.fieldKey === target.fieldKey ? 'remount' : 'switch',
      { clearUi: false, closePanel: false },
    );

    const session = new HistorySession(
      target,
      this.runtime.debug,
      () => {
        if (this.activeSession === session) {
          this.renderButton();
          if (this.isPanelOpen) this.renderPanel();
        }
      },
      (error) => {
        this.handleFatalError('session', error);
      },
    );

    this.activeSession = session;
    logHistoryEvent('history:bind', {
      ...getHistoryTargetLogData(target),
      source,
    }, { debug: this.runtime.debug });
    logHistoryEvent('history:activate', {
      ...getHistoryTargetLogData(target),
      source,
    }, { debug: this.runtime.debug });

    void session.ensureLoaded()
      .then(() => {
        if (this.activeSession !== session) return;
        this.ensureSelectedSnapshot();
        this.renderButton();
        if (this.isPanelOpen) this.renderPanel();
      })
      .catch((error) => {
        this.handleFatalError('activate-ensure-loaded', error);
      });

    this.ensureSelectedSnapshot();
    this.renderButton();
    this.updateFloatingPosition(source, true);
    return session;
  }

  private releaseActiveSession(
    reason: string,
    options: { clearUi: boolean; closePanel: boolean },
  ) {
    const session = this.activeSession;
    if (!session) {
      if (options.clearUi) {
        this.selectedSnapshotId = null;
        if (options.closePanel) this.closePanel();
        this.renderButton();
      }
      return;
    }

    void session.flushPending().catch((error) => {
      this.handleFatalError(`release-${reason}`, error);
    });
    session.destroy();
    logHistoryEvent('history:unbind', {
      ...getHistoryTargetLogData(session.target),
      reason,
    }, { debug: this.runtime.debug });

    this.activeSession = null;
    if (options.clearUi) {
      this.selectedSnapshotId = null;
      if (options.closePanel) {
        this.closePanel();
      }
      this.renderButton();
    }
  }

  private async openPanel() {
    if (!this.showUi || !this.activeSession) return;

    this.isPanelOpen = true;
    setManagedVisibility(this.root, true, 'flex');
    setManagedVisibility(this.button, true, 'flex');
    setManagedVisibility(this.panel, true, 'flex');
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
    if (!this.showUi) return;
    this.isPanelOpen = false;
    setManagedVisibility(this.panel, false, 'flex');
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
    if (!this.showUi) return;

    const session = this.activeSession;
    const hasActiveElement = session?.target.element.isConnected ?? false;

    if (!hasActiveElement || !session) {
      setManagedVisibility(this.panel, false, 'flex');
      setManagedVisibility(this.button, false, 'flex');
      setManagedVisibility(this.root, false, 'flex');
      this.updateFloatingPosition('render-button');
      return;
    }

    setManagedVisibility(this.root, true, 'flex');
    setManagedVisibility(this.button, true, 'flex');
    if (!this.isPanelOpen) {
      setManagedVisibility(this.panel, false, 'flex');
    }

    const versions = session.record?.snapshots ?? [];
    const latest = versions.at(-1);

    this.buttonMeta.textContent = latest
      ? this.isFieldMode
        ? `${versions.length} saved`
        : `${versions.length} version${versions.length === 1 ? '' : 's'} · ${formatRelativeTime(latest.savedAt)}`
      : this.isFieldMode
        ? 'Empty'
        : 'No local versions yet';

    this.updateFloatingPosition('render-button');
  }

  private renderPanel() {
    if (!this.showUi) return;

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
    this.versionsList.replaceChildren();

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
      this.previewDiff.replaceChildren();
      this.restoreButton.disabled = true;
      this.updateFloatingPosition('render-panel');
      return;
    }

    const currentText = session.target.read();
    const diff = diffText(currentText, selected.content);
    const unchanged = diff.addedChars === 0 && diff.removedChars === 0;

    this.previewSummary.textContent = '';
    if (unchanged) {
      this.previewSummary.textContent = 'Selected version matches the current draft.';
    } else {
      this.previewSummary.replaceChildren(renderDiffStat(diff.addedChars, diff.removedChars));
    }

    this.previewDiff.replaceChildren(renderInlineDiff(diff.chunks));
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

  private static isStetOwnedNode(node: Node): boolean {
    const el = node instanceof Element ? node : node.parentElement;
    if (!el) return false;
    return !!el.closest('.stet-overlay-root, .stet-history-root, .stet-card');
  }

  private observeDom() {
    this.observer = new MutationObserver((mutations) => {
      this.runGuarded('mutation-observer', () => {
        // Filter out mutations targeting stet's own DOM to avoid feedback loops
        const filtered = mutations.filter((m) => !VersionHistoryManager.isStetOwnedNode(m.target));
        if (filtered.length === 0) return;

        recordHistoryEventRate('mutation', {
          mutationCount: filtered.length,
        }, this.runtime.debug);

        const session = this.activeSession;
        if (!session) return;

        if (!session.target.element.isConnected) {
          const nextActive = findHistoryEditable(document.activeElement);
          if (nextActive) {
            this.activateElement(nextActive, 'mutation-reconnect');
          } else {
            this.releaseActiveSession('disconnect', { clearUi: true, closePanel: true });
          }
          return;
        }

        this.scheduleFloatingPosition('mutation');
      });
    });

    this.observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private readonly handleFocusIn = (event: FocusEvent) => {
    this.runGuarded('focusin', () => {
      recordHistoryEventRate('focusin', {}, this.runtime.debug);
      if (event.target instanceof Node && this.root.contains(event.target)) return;

      const editable = findHistoryEditable(event.target);
      if (!editable) {
        this.releaseActiveSession('focus-away', { clearUi: true, closePanel: true });
        return;
      }

      this.activateElement(editable, 'focusin');
    });
  };

  private readonly handleInput = (event: Event) => {
    this.runGuarded('input', () => {
      if (event.target instanceof Node && this.root.contains(event.target)) return;

      const editable = findHistoryEditable(event.target);
      if (!editable) return;

      const wasActive = this.activeSession?.target.element === editable;
      if (wasActive) return;

      const session = this.activateElement(editable, 'input');
      if (!session) return;
      session.noteInput();
    });
  };

  private readonly handleFocusOut = (event: FocusEvent) => {
    this.runGuarded('focusout', () => {
      const session = this.activeSession;
      if (!session) return;
      if (event.target instanceof Node && this.root.contains(event.target)) return;

      const fromEditable = findHistoryEditable(event.target);
      if (fromEditable !== session.target.element) return;

      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && this.root.contains(nextTarget)) return;

      const nextEditable = findHistoryEditable(nextTarget);
      if (nextEditable) return;

      this.releaseActiveSession('focusout', { clearUi: true, closePanel: true });
    });
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    this.runGuarded('keydown', () => {
      if (event.key === 'Escape' && this.isPanelOpen) {
        this.closePanel();
      }
    });
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.runGuarded('pointerdown', () => {
      if (!this.isPanelOpen) return;
      if (!(event.target instanceof Node)) return;
      if (this.root.contains(event.target)) return;

      this.closePanel();
    });
  };

  private readonly handleVisibilityChange = () => {
    if (!document.hidden) return;
    this.runAsyncGuarded('visibilitychange', async () => {
      await this.flushAllSessions();
    });
  };

  private readonly handlePageHide = () => {
    this.runAsyncGuarded('pagehide', async () => {
      await this.flushAllSessions();
    });
  };

  private readonly handleViewportShift = () => {
    this.runGuarded('viewport-shift', () => {
      recordHistoryEventRate('viewport', { open: this.isPanelOpen }, this.runtime.debug);
      this.scheduleFloatingPosition('viewport');
    });
  };

  private async flushAllSessions() {
    const startedAt = getNow();
    if (this.activeSession) {
      await this.activeSession.flushPending();
    }
    flushHistoryEventRates(this.runtime.debug);
    logHistoryEvent('history:flush', {
      sessionCount: this.activeSession ? 1 : 0,
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
    if (!this.showUi) return;

    if (!this.isFieldMode) {
      this.clearFloatingStyles();
      if (log) this.logPosition(source);
      return;
    }

    const session = this.activeSession;
    if (!session || !session.target.element.isConnected) {
      setManagedVisibility(this.panel, false, 'flex');
      setManagedVisibility(this.button, false, 'flex');
      setManagedVisibility(this.root, false, 'flex');
      if (log) this.logPosition(source);
      return;
    }

    const targetRect = session.target.element.getBoundingClientRect();
    const obstacles = this.collectLayoutObstacles(session.target.element);
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
      panelHeight: this.isPanelOpen ? (this.panel.offsetHeight || 420) : 420,
      panelOpen: this.isPanelOpen,
      obstacles,
    });

    if (!layout.visible) {
      setManagedVisibility(this.panel, false, 'flex');
      setManagedVisibility(this.button, false, 'flex');
      setManagedVisibility(this.root, false, 'flex');
      if (log) this.logPosition(source);
      return;
    }

    setManagedVisibility(this.root, true, 'flex');
    setManagedVisibility(this.button, true, 'flex');
    this.button.style.left = `${layout.chip.left}px`;
    this.button.style.top = `${layout.chip.top}px`;
    this.button.style.width = `${layout.chip.width}px`;

    setManagedVisibility(this.panel, this.isPanelOpen, 'flex');
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

  private collectLayoutObstacles(targetElement: HTMLElement): HistoryLayoutRect[] {
    const now = performance.now();
    if (this.obstacleCache && now - this.obstacleCacheTime < VersionHistoryManager.OBSTACLE_CACHE_TTL_MS) {
      return this.obstacleCache;
    }

    const selector = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      'summary',
    ].join(', ');

    const result = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        if (!element.isConnected) return false;
        if (this.root.contains(element)) return false;
        // Skip stet's own overlay marks and UI elements
        if (element.closest('.stet-overlay-root, .stet-history-root, .stet-card')) return false;
        if (element === targetElement) return false;
        if (targetElement.contains(element)) return false;
        if (element.contains(targetElement)) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      });

    this.obstacleCache = result;
    this.obstacleCacheTime = now;
    return result;
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
    // Always use page mode (fixed bottom-right) — never float over the editor
    return false;
  }

  private get showUi(): boolean {
    return this.runtime.allowAnchoredUi;
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
  if (queryOverride === 'off' || queryOverride === 'field') {
    return queryOverride;
  }
  if (queryOverride === 'page') {
    return 'field';
  }

  const windowOverride = window.__stetHistoryUiMode;
  if (windowOverride === 'off' || windowOverride === 'field') {
    return windowOverride;
  }
  if (windowOverride === 'page') {
    return 'field';
  }

  return undefined;
}

function renderInlineDiff(chunks: DiffChunk[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (chunks.length === 0) {
    const note = document.createElement('p');
    note.className = 'stet-history-preview-note';
    note.textContent = 'No textual differences.';
    fragment.append(note);
    return fragment;
  }

  for (const chunk of chunks) {
    if (chunk.type === 'insert') {
      const ins = document.createElement('ins');
      ins.className = 'stet-history-diff-ins';
      ins.textContent = chunk.value;
      fragment.append(ins);
    } else if (chunk.type === 'delete') {
      const del = document.createElement('del');
      del.className = 'stet-history-diff-del';
      del.textContent = chunk.value;
      fragment.append(del);
    } else {
      fragment.append(document.createTextNode(chunk.value));
    }
  }

  return fragment;
}

function renderDiffStat(added: number, removed: number): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const BLOCKS = 5;
  const total = added + removed;
  const addBlocks = total > 0 ? Math.max(added > 0 ? 1 : 0, Math.round((added / total) * BLOCKS)) : 0;
  const removeBlocks = total > 0 ? BLOCKS - addBlocks : 0;

  const addSpan = document.createElement('span');
  addSpan.className = 'stet-history-stat-add';
  addSpan.textContent = `+${added}`;

  const removeSpan = document.createElement('span');
  removeSpan.className = 'stet-history-stat-remove';
  removeSpan.textContent = ` -${removed} `;

  fragment.append(addSpan, removeSpan);

  for (let i = 0; i < addBlocks; i++) {
    const block = document.createElement('span');
    block.className = 'stet-history-stat-block-add';
    block.textContent = '■';
    fragment.append(block);
  }
  for (let i = 0; i < removeBlocks; i++) {
    const block = document.createElement('span');
    block.className = 'stet-history-stat-block-remove';
    block.textContent = '■';
    fragment.append(block);
  }

  return fragment;
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

function getInitialHistoryEditable(start: Element | null): HTMLElement | null {
  if (!(start instanceof HTMLElement)) return null;

  if (start instanceof HTMLTextAreaElement || start instanceof HTMLInputElement) {
    return findHistoryEditable(start);
  }

  if (start.isContentEditable || start.getAttribute('contenteditable') !== null) {
    return findHistoryEditable(start);
  }

  return null;
}
