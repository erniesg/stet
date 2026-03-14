import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatSiteAllowlist, parseSiteAllowlistInput } from '../host-access.js';

function Options() {
  const [siteAllowlist, setSiteAllowlist] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_RAW_SETTINGS' }, (resp) => {
      setSiteAllowlist(formatSiteAllowlist(resp?.userOverrides?.siteAllowlist));
      setLoading(false);
    });
  }, []);

  const save = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: {
        siteAllowlist: parseSiteAllowlistInput(siteAllowlist),
      },
    }, () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    });
  };

  const reset = () => {
    setSiteAllowlist('');
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: {
        siteAllowlist: [],
      },
    }, () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    });
  };

  return (
    <div style={{ maxWidth: '720px', margin: '24px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>Stet Settings</h1>
      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff' }}>
        <h2 style={{ marginTop: 0 }}>Site Scope</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Leave this list empty to run Stet on every site. Add hostnames here to run Stet only on those sites.
          Use one hostname per line, for example `cms.example.com` or `mail.google.com`.
        </p>
        <p style={{ color: '#6b7280', fontSize: '13px', lineHeight: 1.5 }}>
          If you want to block a single site while keeping Stet on everywhere else, Chrome also supports browser-level
          site access controls from Extensions {'>'} Stet Style Checker {'>'} This can read and change site data.
        </p>
        <textarea
          value={siteAllowlist}
          onInput={(event) => setSiteAllowlist((event.currentTarget as HTMLTextAreaElement).value)}
          disabled={loading}
          placeholder={'cms.example.com\nstudio.workspace.google.com'}
          style={{
            width: '100%',
            minHeight: '180px',
            padding: '12px',
            borderRadius: '12px',
            border: '1px solid #d1d5db',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '13px',
            lineHeight: 1.5,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '12px', marginTop: '14px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={save}
            disabled={loading}
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            Save site scope
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={loading}
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid #d1d5db',
              background: '#fff',
              color: '#111827',
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            Allow everywhere
          </button>
          {saved && <span style={{ color: '#16a34a', fontSize: '13px' }}>Saved</span>}
        </div>
      </section>
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
