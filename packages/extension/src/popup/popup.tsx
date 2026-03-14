import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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
  activeFieldKey: string | null;
  activeLabel: string | null;
  issues: PopupIssue[];
}

const EMPTY_ISSUES_STATE: PopupIssuesState = {
  enabled: false,
  totalIssues: 0,
  editorCount: 0,
  activeFieldKey: null,
  activeLabel: null,
  issues: [],
};

function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [packs, setPacks] = useState<string[]>([]);
  const [role, setRole] = useState('subeditor');
  const [loading, setLoading] = useState(true);
  const [issuesState, setIssuesState] = useState<PopupIssuesState>(EMPTY_ISSUES_STATE);
  const [selectedByField, setSelectedByField] = useState<Record<string, string[]>>({});
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const activeFieldKey = issuesState.activeFieldKey;
  const selectedKeys = activeFieldKey ? (selectedByField[activeFieldKey] ?? []) : [];
  const fixableKeys = issuesState.issues.filter((issue) => issue.canFix).map((issue) => issue.key);
  const fixableCount = fixableKeys.length;

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      if (resp?.config) {
        setEnabled(resp.config.enabled);
        setPacks(resp.config.packs || []);
        setRole(resp.config.role || 'subeditor');
      }
      setLoading(false);
    });

    loadPageIssues(setIssuesState, setIssuesError);
  }, []);

  useEffect(() => {
    if (!activeFieldKey) return;

    setSelectedByField((prev) => {
      const existing = prev[activeFieldKey];
      const nextSelection = existing
        ? fixableKeys.filter((key) => existing.includes(key))
        : [...fixableKeys];

      return { ...prev, [activeFieldKey]: nextSelection };
    });
  }, [activeFieldKey, fixableKeys.join('|')]);

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
    loadPageIssues(setIssuesState, setIssuesError);
  };

  const toggleIssueSelection = (issueKey: string, checked: boolean) => {
    if (!activeFieldKey) return;

    setSelectedByField((prev) => {
      const current = prev[activeFieldKey] ?? [];
      const next = checked
        ? [...current, issueKey]
        : current.filter((key) => key !== issueKey);
      return { ...prev, [activeFieldKey]: next };
    });
  };

  const applySelected = () => {
    if (!activeFieldKey || selectedKeys.length === 0 || applying) return;

    setApplying(true);
    withActiveTab((tabId) => {
      chrome.tabs.sendMessage(tabId, {
        type: 'APPLY_EDITOR_ISSUES',
        fieldKey: activeFieldKey,
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
        Review the current page’s issues here. Inline highlights stay on the page; the full issue list lives in this popup.
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
                    {issue.suggestion ? `${issue.originalText} -> ${issue.suggestion}` : issue.originalText}
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

      <div style={styles.footer}>
        <span style={styles.footerText}>"Let it stand."</span>
      </div>
    </div>
  );
}

function loadPageIssues(
  setIssuesState: (state: PopupIssuesState) => void,
  setIssuesError: (error: string | null) => void,
) {
  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_ISSUES' }, (resp) => {
      if (chrome.runtime.lastError) {
        setIssuesState(EMPTY_ISSUES_STATE);
        setIssuesError('Could not read issues from this page yet.');
        return;
      }

      setIssuesState((resp as PopupIssuesState | undefined) ?? EMPTY_ISSUES_STATE);
      setIssuesError(null);
    });
  }, () => {
    setIssuesState(EMPTY_ISSUES_STATE);
    setIssuesError('Could not find the active tab.');
  });
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
    maxHeight: '260px',
    overflowY: 'auto',
    marginTop: '10px',
    marginBottom: '10px',
    paddingRight: '4px',
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
