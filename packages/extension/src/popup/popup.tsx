import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

const COLORS = {
  primary: '#6366f1',
  green: '#22c55e',
  orange: '#f59e0b',
  gray: '#6b7280',
  lightBg: '#f9fafb',
  border: '#e5e7eb',
};

const ROLES = [
  { id: 'journalist', label: 'Journalist', desc: 'House style only — readability off' },
  { id: 'subeditor', label: 'Sub-editor', desc: 'Everything — readability, style, grammar' },
];

function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [packs, setPacks] = useState<string[]>([]);
  const [role, setRole] = useState('subeditor');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      if (resp?.config) {
        setEnabled(resp.config.enabled);
        setPacks(resp.config.packs || []);
        setRole(resp.config.role || 'subeditor');
      }
      setLoading(false);
    });
  }, []);

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
    // Also update the resolved config so content script picks it up
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      if (resp?.config) {
        chrome.runtime.sendMessage({
          type: 'SET_RESOLVED_CONFIG',
          config: { ...resp.config, role: newRole },
        });
      }
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
      {/* Header */}
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
          <div style={{
            ...styles.toggleKnob,
            transform: enabled ? 'translateX(16px)' : 'translateX(0)',
          }} />
        </button>
      </div>

      {/* Status */}
      <div style={styles.status}>
        <div style={{
          ...styles.dot,
          background: enabled ? COLORS.green : COLORS.gray,
        }} />
        <span style={{ fontSize: '13px', color: enabled ? '#1f2937' : COLORS.gray }}>
          {enabled ? 'Checking active' : 'Paused'}
        </span>
      </div>

      <div style={styles.helper}>
        Focus an editor to open the on-page Issues and Version history drawers.
      </div>

      {/* Role selector */}
      <div style={styles.section}>
        <span style={styles.sectionLabel}>Role</span>
        <div style={styles.roleGroup}>
          {ROLES.map(r => (
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
        <span style={{ fontSize: '11px', color: COLORS.gray, marginTop: '4px', display: 'block' }}>
          {ROLES.find(r => r.id === role)?.desc}
        </span>
      </div>

      {/* Packs */}
      <div style={styles.section}>
        <div style={styles.configRow}>
          <span style={styles.sectionLabel}>Packs</span>
          <span style={{ fontSize: '12px', color: '#374151', fontWeight: '500' }}>
            {packs.join(', ') || 'common'}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <span style={{ fontSize: '11px', color: '#9ca3af' }}>
          "Let it stand."
        </span>
      </div>
    </div>
  );
}

const styles: Record<string, Record<string, string | number>> = {
  container: {
    width: '280px',
    padding: '16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
    color: '#1f2937',
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
  section: {
    borderTop: `1px solid ${COLORS.border}`,
    paddingTop: '10px',
    marginBottom: '8px',
  },
  helper: {
    fontSize: '12px',
    lineHeight: '1.45',
    color: COLORS.gray,
    marginBottom: '10px',
  },
  sectionLabel: {
    fontSize: '12px',
    color: COLORS.gray,
    marginBottom: '6px',
    display: 'block',
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
  configRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footer: {
    borderTop: `1px solid ${COLORS.border}`,
    paddingTop: '8px',
    textAlign: 'center',
  },
};

render(<Popup />, document.getElementById('app')!);
