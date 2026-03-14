import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { diffText, type DiffChunk } from '../content/version-history-diff.js';
import type { EditableHistoryRecord, VersionSnapshot } from '../content/version-history-core.js';

const COLORS = {
  primary: '#6366f1',
  green: '#22c55e',
  gray: '#6b7280',
  lightBg: '#f9fafb',
  border: '#e5e7eb',
  text: '#1f2937',
  subtle: '#94a3b8',
};

const ROLES = [
  { id: 'journalist', label: 'Journalist', desc: 'House style only — readability off' },
  { id: 'subeditor', label: 'Sub-editor', desc: 'Everything — readability, style, grammar' },
];

interface PopupIssue {
  key: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  originalText: string;
  suggestion: string | null | undefined;
  description: string;
  canFix: boolean;
}

interface PopupIssuesState {
  enabled: boolean;
  totalIssues: number;
  editorCount: number;
  activeFrameId: number | null;
  activeFieldKey: string | null;
  activeLabel: string | null;
  issues: PopupIssue[];
}

interface PopupHistoryContextResponse {
  ok: boolean;
  currentText: string;
  label: string | null;
}

const EMPTY_ISSUES_STATE: PopupIssuesState = {
  enabled: false,
  totalIssues: 0,
  editorCount: 0,
  activeFrameId: null,
  activeFieldKey: null,
  activeLabel: null,
  issues: [],
};

const HISTORY_STORAGE_PREFIX = 'stet:history:';

function formatSuggestion(issue: PopupIssue): string {
  if (typeof issue.suggestion !== 'string') return issue.originalText;
  const replacement = issue.suggestion.length > 0 ? issue.suggestion : 'remove';
  return `${issue.originalText} -> ${replacement}`;
}

function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [packs, setPacks] = useState<string[]>([]);
  const [role, setRole] = useState('subeditor');
  const [loading, setLoading] = useState(true);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [issuesState, setIssuesState] = useState<PopupIssuesState>(EMPTY_ISSUES_STATE);
  const [selectedByField, setSelectedByField] = useState<Record<string, string[]>>({});
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [historySnapshots, setHistorySnapshots] = useState<VersionSnapshot[]>([]);
  const [historyCurrentText, setHistoryCurrentText] = useState('');
  const [historyLabel, setHistoryLabel] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [historyRestoring, setHistoryRestoring] = useState(false);
  const [historySnapshotting, setHistorySnapshotting] = useState(false);
  const activeTargetKey = getActiveTargetKey(issuesState);
  const selectedKeys = activeTargetKey ? (selectedByField[activeTargetKey] ?? []) : [];
  const fixableKeys = issuesState.issues.filter((issue) => issue.canFix).map((issue) => issue.key);
  const fixableCount = fixableKeys.length;
  const selectedSnapshot = historySnapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null;
  const historyDiff = selectedSnapshot ? diffText(historyCurrentText, selectedSnapshot.content) : null;

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      if (resp?.config) {
        setEnabled(resp.config.enabled);
        setPacks(resp.config.packs || []);
        setRole(resp.config.role || 'subeditor');
      }
      setLoading(false);
    });

    loadPageIssues(setIssuesState, setIssuesError, setActiveTabId);
  }, []);

  useEffect(() => {
    const handleMessage = (
      message: { type?: string; tabId?: number; state?: PopupIssuesState },
    ) => {
      if (message?.type !== 'TAB_ISSUES_UPDATED') return;
      if (activeTabId === null || message.tabId !== activeTabId) return;
      setIssuesState(message.state ?? EMPTY_ISSUES_STATE);
      setIssuesError(null);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [activeTabId]);

  useEffect(() => {
    if (activeTabId === null || issuesState.activeFrameId === null || !issuesState.activeFieldKey) {
      setHistorySnapshots([]);
      setHistoryCurrentText('');
      setHistoryLabel(null);
      setSelectedSnapshotId(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }

    void refreshHistory(activeTabId, issuesState.activeFrameId, issuesState.activeFieldKey);
  }, [
    activeTabId,
    issuesState.activeFrameId,
    issuesState.activeFieldKey,
    issuesState.totalIssues,
    issuesState.issues.map((issue) => issue.key).join('|'),
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      loadPageIssues(setIssuesState, setIssuesError, setActiveTabId);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!activeTargetKey) return;

    setSelectedByField((prev) => {
      const existing = prev[activeTargetKey];
      const nextSelection = existing
        ? fixableKeys.filter((key) => existing.includes(key))
        : [...fixableKeys];

      return { ...prev, [activeTargetKey]: nextSelection };
    });
  }, [activeTargetKey, fixableKeys.join('|')]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: { enabled: next },
    });
    if (!next) {
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: 0 });
    }
  };

  const changeRole = (newRole: string) => {
    setRole(newRole);
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: { role: newRole },
    });
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      if (resp?.config) {
        chrome.runtime.sendMessage({
          type: 'SET_RESOLVED_CONFIG',
          config: { ...resp.config, role: newRole },
        });
      }
    });
  };

  const refreshIssues = () => {
    loadPageIssues(setIssuesState, setIssuesError, setActiveTabId);
  };

  const refreshHistoryForActive = () => {
    if (activeTabId === null || issuesState.activeFrameId === null || !issuesState.activeFieldKey) return;
    void refreshHistory(activeTabId, issuesState.activeFrameId, issuesState.activeFieldKey);
  };

  const toggleIssueSelection = (issueKey: string, checked: boolean) => {
    if (!activeTargetKey) return;

    setSelectedByField((prev) => {
      const current = prev[activeTargetKey] ?? [];
      const next = checked
        ? [...current, issueKey]
        : current.filter((key) => key !== issueKey);
      return { ...prev, [activeTargetKey]: next };
    });
  };

  const applySelected = () => {
    if (!issuesState.activeFieldKey || issuesState.activeFrameId === null || selectedKeys.length === 0 || applying) return;

    setApplying(true);
    withActiveTab((tabId) => {
      chrome.runtime.sendMessage({
        type: 'APPLY_TAB_ISSUES',
        tabId,
        frameId: issuesState.activeFrameId,
        fieldKey: issuesState.activeFieldKey,
        issueKeys: selectedKeys,
      }, (resp) => {
        setApplying(false);

        if (chrome.runtime.lastError) {
          setIssuesError('Could not apply fixes on this page.');
          return;
        }

        if (resp?.state) {
          setIssuesState(resp.state as PopupIssuesState);
          setIssuesError(null);
          return;
        }

        refreshIssues();
      });
    }, () => {
      setApplying(false);
      setIssuesError('Could not find the active tab.');
    });
  };

  const captureSnapshot = () => {
    if (activeTabId === null || issuesState.activeFrameId === null || !issuesState.activeFieldKey || historySnapshotting) return;

    setHistorySnapshotting(true);
    sendFrameMessage<PopupHistoryContextResponse>(activeTabId, issuesState.activeFrameId, {
      type: 'CAPTURE_EDITOR_SNAPSHOT',
      fieldKey: issuesState.activeFieldKey,
    }).then((resp) => {
      setHistorySnapshotting(false);
      if (!resp?.ok) {
        setHistoryError('Could not save a snapshot for this editor.');
        return;
      }

      setHistoryCurrentText(resp.currentText);
      setHistoryError(null);
      refreshHistoryForActive();
    }).catch(() => {
      setHistorySnapshotting(false);
      setHistoryError('Could not save a snapshot for this editor.');
    });
  };

  const restoreSnapshot = () => {
    if (
      activeTabId === null ||
      issuesState.activeFrameId === null ||
      !issuesState.activeFieldKey ||
      !selectedSnapshot ||
      historyRestoring
    ) return;

    const ok = window.confirm('Replace the current editor contents with this saved version?');
    if (!ok) return;

    setHistoryRestoring(true);
    sendFrameMessage<{
      ok: boolean;
      currentText: string;
      state?: PopupIssuesState;
    }>(activeTabId, issuesState.activeFrameId, {
      type: 'RESTORE_EDITOR_SNAPSHOT',
      fieldKey: issuesState.activeFieldKey,
      snapshotId: selectedSnapshot.id,
    }).then((resp) => {
      setHistoryRestoring(false);
      if (!resp?.ok) {
        setHistoryError('Could not restore this version.');
        return;
      }

      setHistoryCurrentText(resp.currentText);
      if (resp.state) setIssuesState(resp.state);
      setHistoryError(null);
      refreshHistoryForActive();
    }).catch(() => {
      setHistoryRestoring(false);
      setHistoryError('Could not restore this version.');
    });
  };

  async function refreshHistory(tabId: number, frameId: number, fieldKey: string) {
    setHistoryLoading(true);

    try {
      const [record, context] = await Promise.all([
        loadStoredHistory(fieldKey),
        sendFrameMessage<PopupHistoryContextResponse>(tabId, frameId, {
          type: 'GET_EDITOR_HISTORY_STATE',
          fieldKey,
        }),
      ]);

      if (!context?.ok) {
        setHistorySnapshots([]);
        setHistoryCurrentText('');
        setHistoryLabel(record?.label ?? issuesState.activeLabel ?? null);
        setSelectedSnapshotId(null);
        setHistoryError('Could not read live editor history on this page.');
        setHistoryLoading(false);
        return;
      }

      const snapshots = record?.snapshots ?? [];
      setHistorySnapshots(snapshots);
      setHistoryCurrentText(context.currentText);
      setHistoryLabel(context.label ?? record?.label ?? issuesState.activeLabel ?? null);
      setSelectedSnapshotId((current) => getPreferredSnapshotId(current, snapshots, context.currentText));
      setHistoryError(null);
    } catch {
      setHistoryError('Could not load version history yet.');
    } finally {
      setHistoryLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={{ color: COLORS.gray, fontSize: '13px' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.logoRow}>
          <div style={styles.logo}>S</div>
          <span style={styles.title}>{chrome.runtime.getManifest().name}</span>
        </div>
        <button
          onClick={toggle}
          style={{
            ...styles.toggle,
            background: enabled ? COLORS.green : COLORS.gray,
          }}
        >
          <div
            style={{
              ...styles.toggleKnob,
              transform: enabled ? 'translateX(16px)' : 'translateX(0)',
            }}
          />
        </button>
      </div>

      <div style={styles.status}>
        <div
          style={{
            ...styles.dot,
            background: enabled ? COLORS.green : COLORS.gray,
          }}
        />
        <span style={{ fontSize: '13px', color: enabled ? COLORS.text : COLORS.gray }}>
          {enabled ? 'Checking active' : 'Paused'}
        </span>
      </div>

      <div style={styles.helper}>
        Review issues and local version history here.
      </div>

      <div style={styles.section}>
        <span style={styles.sectionLabel}>Role</span>
        <div style={styles.roleGroup}>
          {ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => changeRole(r.id)}
              style={{
                ...styles.roleBtn,
                background: role === r.id ? COLORS.primary : '#fff',
                color: role === r.id ? '#fff' : '#374151',
                borderColor: role === r.id ? COLORS.primary : COLORS.border,
              }}
            >
              <span style={{ fontWeight: '500', fontSize: '12px' }}>{r.label}</span>
            </button>
          ))}
        </div>
        <span style={styles.roleDescription}>
          {ROLES.find((r) => r.id === role)?.desc}
        </span>
      </div>

      <div style={styles.section}>
        <div style={styles.configRow}>
          <span style={styles.sectionLabel}>Packs</span>
          <span style={styles.valueText}>{packs.join(', ') || 'common'}</span>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.configRow}>
          <span style={styles.sectionLabel}>Issues</span>
          <button type="button" style={styles.linkButton} onClick={refreshIssues}>
            Refresh
          </button>
        </div>

        <div style={styles.issueSummary}>
          {issuesState.totalIssues} issue{issuesState.totalIssues === 1 ? '' : 's'} on page
          {` · ${fixableCount} fixable here`}
        </div>

        <div style={styles.issueMeta}>
          {issuesState.activeLabel
            ? `Current editor: ${issuesState.activeLabel}`
            : 'No editor detected on this page.'}
        </div>

        {issuesState.editorCount > 1 && issuesState.activeLabel && (
          <div style={styles.issueMeta}>
            Showing the last focused editor.
          </div>
        )}

        {issuesError && <div style={styles.errorText}>{issuesError}</div>}

        <div style={styles.issueList}>
          {issuesState.issues.length === 0 && !issuesError && (
            <div style={styles.emptyState}>No issues for the current editor.</div>
          )}

          {issuesState.issues.map((issue) => {
            const checked = selectedKeys.includes(issue.key);
            return (
              <label
                key={issue.key}
                style={{
                  ...styles.issueRow,
                  opacity: issue.canFix ? 1 : 0.85,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!issue.canFix}
                  onChange={(event) => toggleIssueSelection(issue.key, event.currentTarget.checked)}
                  style={styles.checkbox}
                />
                <div style={styles.issueContent}>
                  <div style={styles.issueRule}>{issue.rule}</div>
                  <div style={styles.issueText}>
                    {formatSuggestion(issue)}
                  </div>
                  <div style={styles.issueDescription}>{issue.description}</div>
                </div>
              </label>
            );
          })}
        </div>

        <button
          type="button"
          onClick={applySelected}
          disabled={selectedKeys.length === 0 || applying}
          style={{
            ...styles.primaryButton,
            opacity: selectedKeys.length === 0 || applying ? 0.55 : 1,
          }}
        >
          {applying
            ? 'Applying...'
            : selectedKeys.length === 0
              ? 'No selected fixes'
              : `Apply selected (${selectedKeys.length})`}
        </button>
      </div>

      <div style={styles.section}>
        <div style={styles.configRow}>
          <span style={styles.sectionLabel}>Version History</span>
          <div style={styles.inlineActions}>
            <button type="button" style={styles.linkButton} onClick={refreshHistoryForActive}>
              Refresh
            </button>
            <button
              type="button"
              style={styles.linkButton}
              onClick={captureSnapshot}
              disabled={!issuesState.activeFieldKey || historySnapshotting}
            >
              {historySnapshotting ? 'Saving...' : 'Snapshot now'}
            </button>
          </div>
        </div>

        <div style={styles.issueSummary}>
          {historySnapshots.length} saved version{historySnapshots.length === 1 ? '' : 's'}
        </div>

        <div style={styles.issueMeta}>
          {historyLabel
            ? `Current editor: ${historyLabel}`
            : 'No editor detected on this page.'}
        </div>

        {historyError && <div style={styles.errorText}>{historyError}</div>}

        {historyLoading ? (
          <div style={styles.emptyState}>Loading version history...</div>
        ) : historySnapshots.length === 0 ? (
          <div style={styles.emptyState}>No local versions saved for the current editor yet.</div>
        ) : (
          <>
            <div style={styles.historyList}>
              {[...historySnapshots].reverse().map((snapshot) => {
                const selected = snapshot.id === selectedSnapshotId;
                return (
                  <button
                    key={snapshot.id}
                    type="button"
                    onClick={() => setSelectedSnapshotId(snapshot.id)}
                    style={{
                      ...styles.historyRow,
                      ...(selected ? styles.historyRowSelected : {}),
                    }}
                  >
                    <div style={styles.historyRowTitle}>{formatSnapshotLabel(snapshot)}</div>
                    <div style={styles.historyRowMeta}>
                      {formatAbsoluteDate(snapshot.savedAt)} · {snapshot.charCount.toLocaleString()} chars
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={styles.historyPreview}>
              <div style={styles.historyPreviewSummary}>
                {selectedSnapshot && historyDiff
                  ? historyDiff.addedChars === 0 && historyDiff.removedChars === 0
                    ? 'Selected version matches the current editor text.'
                    : `Restoring this version adds ${historyDiff.addedChars.toLocaleString()} chars and removes ${historyDiff.removedChars.toLocaleString()} chars.`
                  : 'Pick a saved version to compare against the current editor.'}
              </div>
              <div style={styles.historyDiffBox}>
                {selectedSnapshot && historyDiff
                  ? renderDiffPreview(historyDiff.chunks)
                  : <span style={styles.emptyState}>No diff preview available.</span>}
              </div>
            </div>

            <button
              type="button"
              onClick={restoreSnapshot}
              disabled={!selectedSnapshot || historyRestoring}
              style={{
                ...styles.primaryButton,
                ...(selectedSnapshot && !historyRestoring ? {} : styles.disabledButton),
              }}
            >
              {historyRestoring ? 'Restoring...' : selectedSnapshot ? 'Restore selected version' : 'Select a version'}
            </button>
          </>
        )}
      </div>

      <div style={styles.footer}>
        <span style={styles.footerText}>"Let it stand."</span>
      </div>
    </div>
  );
}

function loadPageIssues(
  setIssuesState: (state: PopupIssuesState) => void,
  setIssuesError: (error: string | null) => void,
  setActiveTabId?: (tabId: number | null) => void,
) {
  withActiveTab((tabId) => {
    setActiveTabId?.(tabId);
    chrome.runtime.sendMessage({ type: 'GET_TAB_ISSUES', tabId }, (resp) => {
      if (chrome.runtime.lastError) {
        setIssuesState(EMPTY_ISSUES_STATE);
        setIssuesError('Could not read issues from this page yet.');
        return;
      }

      setIssuesState((resp as PopupIssuesState | undefined) ?? EMPTY_ISSUES_STATE);
      setIssuesError(null);
    });
  }, () => {
    setActiveTabId?.(null);
    setIssuesState(EMPTY_ISSUES_STATE);
    setIssuesError('Could not find the active tab.');
  });
}

function loadStoredHistory(fieldKey: string): Promise<EditableHistoryRecord | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(`${HISTORY_STORAGE_PREFIX}${fieldKey}`, (result) => {
      resolve((result[`${HISTORY_STORAGE_PREFIX}${fieldKey}`] as EditableHistoryRecord | undefined) ?? null);
    });
  });
}

function sendFrameMessage<T>(tabId: number, frameId: number, message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve((resp as T | undefined) ?? null);
    });
  });
}

function getPreferredSnapshotId(
  currentId: string | null,
  snapshots: VersionSnapshot[],
  currentText: string,
): string | null {
  if (snapshots.length === 0) return null;
  if (currentId && snapshots.some((snapshot) => snapshot.id === currentId)) return currentId;

  const latest = snapshots.at(-1);
  const fallback = snapshots.at(-2) ?? latest;
  return latest && latest.content === currentText ? fallback?.id ?? null : latest?.id ?? null;
}

function formatSnapshotLabel(snapshot: VersionSnapshot): string {
  const source = snapshot.source === 'manual'
    ? 'Manual snapshot'
    : snapshot.source === 'restore'
      ? 'Restore point'
      : 'Autosave';

  return `${source}${snapshot.isMilestone ? ' · milestone' : ''} · ${formatRelativeTime(snapshot.savedAt)}`;
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
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateString));
}

function renderDiffPreview(chunks: DiffChunk[]) {
  if (chunks.length === 0) {
    return <span style={styles.emptyState}>No textual differences.</span>;
  }

  return chunks.map((chunk, index) => {
    if (chunk.type === 'insert') {
      return <ins key={index} style={styles.diffInsert}>{chunk.value}</ins>;
    }
    if (chunk.type === 'delete') {
      return <del key={index} style={styles.diffDelete}>{chunk.value}</del>;
    }
    return <span key={index}>{chunk.value}</span>;
  });
}

function getActiveTargetKey(state: PopupIssuesState): string | null {
  if (state.activeFrameId === null || !state.activeFieldKey) return null;
  return `${state.activeFrameId}:${state.activeFieldKey}`;
}

function withActiveTab(onTab: (tabId: number) => void, onMissing?: () => void) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (typeof tabId === 'number') {
      onTab(tabId);
      return;
    }
    onMissing?.();
  });
}

const styles: Record<string, Record<string, string | number>> = {
  container: {
    width: '320px',
    maxHeight: '580px',
    overflowY: 'auto',
    padding: '16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: COLORS.text,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  logo: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    background: COLORS.primary,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    fontSize: '16px',
  },
  title: {
    fontSize: '16px',
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: '-0.01em',
  },
  toggle: {
    width: '40px',
    height: '24px',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    padding: '2px',
    transition: 'background 0.2s',
  },
  toggleKnob: {
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    background: '#fff',
    transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    padding: '8px 10px',
    background: COLORS.lightBg,
    borderRadius: '6px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '4px',
  },
  helper: {
    fontSize: '12px',
    lineHeight: '1.45',
    color: COLORS.gray,
    marginBottom: '10px',
  },
  section: {
    borderTop: `1px solid ${COLORS.border}`,
    paddingTop: '10px',
    marginBottom: '10px',
  },
  sectionLabel: {
    fontSize: '12px',
    color: COLORS.gray,
    marginBottom: '6px',
    display: 'block',
  },
  configRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  inlineActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  valueText: {
    fontSize: '12px',
    color: '#374151',
    fontWeight: '500',
    textAlign: 'right',
  },
  roleGroup: {
    display: 'flex',
    gap: '6px',
  },
  roleBtn: {
    flex: '1',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s',
  },
  roleDescription: {
    fontSize: '11px',
    color: COLORS.gray,
    marginTop: '4px',
    display: 'block',
  },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: COLORS.primary,
    cursor: 'pointer',
    fontSize: '12px',
    padding: 0,
  },
  issueSummary: {
    fontSize: '12px',
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: '4px',
  },
  issueMeta: {
    fontSize: '11px',
    color: COLORS.gray,
    marginBottom: '4px',
  },
  errorText: {
    fontSize: '11px',
    color: '#b91c1c',
    marginTop: '6px',
  },
  issueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
    marginBottom: '10px',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
    marginBottom: '10px',
  },
  historyRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    padding: '10px',
    background: '#fff',
    textAlign: 'left',
    cursor: 'pointer',
  },
  historyRowSelected: {
    borderColor: COLORS.primary,
    background: '#eef2ff',
  },
  historyRowTitle: {
    fontSize: '12px',
    fontWeight: '600',
    color: COLORS.text,
  },
  historyRowMeta: {
    fontSize: '11px',
    color: COLORS.gray,
  },
  historyPreview: {
    marginBottom: '10px',
  },
  historyPreviewSummary: {
    fontSize: '11px',
    color: COLORS.gray,
    lineHeight: '1.45',
    marginBottom: '8px',
  },
  historyDiffBox: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    padding: '10px',
    background: COLORS.lightBg,
    fontSize: '12px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '180px',
    overflowY: 'auto',
  },
  diffInsert: {
    background: 'rgba(34, 197, 94, 0.18)',
    color: '#166534',
    textDecoration: 'none',
  },
  diffDelete: {
    background: 'rgba(239, 68, 68, 0.18)',
    color: '#991b1b',
    textDecoration: 'line-through',
  },
  issueRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    padding: '10px',
    background: '#fff',
  },
  checkbox: {
    marginTop: '2px',
  },
  issueContent: {
    minWidth: 0,
    flex: 1,
  },
  issueRule: {
    fontSize: '11px',
    fontWeight: '700',
    color: COLORS.subtle,
    letterSpacing: '0.06em',
    marginBottom: '4px',
  },
  issueText: {
    fontSize: '13px',
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: '1.35',
    wordBreak: 'break-word',
    marginBottom: '4px',
  },
  issueDescription: {
    fontSize: '12px',
    color: COLORS.gray,
    lineHeight: '1.4',
    wordBreak: 'break-word',
  },
  emptyState: {
    fontSize: '12px',
    color: COLORS.gray,
    padding: '8px 0',
  },
  primaryButton: {
    width: '100%',
    border: 'none',
    borderRadius: '8px',
    background: COLORS.primary,
    color: '#fff',
    fontWeight: '600',
    fontSize: '13px',
    padding: '10px 12px',
    cursor: 'pointer',
  },
  disabledButton: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  footer: {
    borderTop: `1px solid ${COLORS.border}`,
    paddingTop: '8px',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '11px',
    color: '#9ca3af',
  },
};

render(<Popup />, document.getElementById('app')!);
