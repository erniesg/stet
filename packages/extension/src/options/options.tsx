import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Language } from 'stet';
import { loadCustomTerms, saveCustomTerms } from '../content/dictionary-loader.js';
import { formatSiteAllowlist, parseSiteAllowlistInput } from '../host-access.js';

const ENGLISH_VARIANTS: { id: Language; label: string; description: string }[] = [
  { id: 'en-GB', label: 'British English (en-GB)', description: 'Default. Commonwealth spelling and style.' },
  { id: 'en-US', label: 'American English (en-US)', description: 'US spelling and style.' },
];

function Options() {
  const [language, setLanguage] = useState<Language>('en-GB');
  const [siteAllowlist, setSiteAllowlist] = useState('');
  const [customTerms, setCustomTerms] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfigState = () => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
      const lang = resp?.config?.language ?? 'en-GB';
      setLanguage(lang);
      setLoading(false);
    });

    chrome.runtime.sendMessage({ type: 'GET_RAW_SETTINGS' }, (resp) => {
      setSiteAllowlist(formatSiteAllowlist(resp?.userOverrides?.siteAllowlist));
    });
  };

  useEffect(() => {
    loadConfigState();
    loadCustomTerms().then((terms) => {
      setCustomTerms(terms.join('\n'));
    });
  }, []);

  const showStatus = (message: string) => {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(null), 1800);
  };

  const applyLanguage = (nextLanguage: Language) => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: { language: nextLanguage },
    }, () => {
      setLanguage(nextLanguage);
      showStatus(`Language set to ${nextLanguage}`);
    });
  };

  const saveSiteScope = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: {
        siteAllowlist: parseSiteAllowlistInput(siteAllowlist),
      },
    }, () => {
      showStatus('Saved site scope');
    });
  };

  const resetSiteScope = () => {
    setSiteAllowlist('');
    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: {
        siteAllowlist: [],
      },
    }, () => {
      showStatus('Allowing all sites');
    });
  };

  const saveTerms = async () => {
    await saveCustomTerms(customTerms.split('\n'));
    const refreshedTerms = await loadCustomTerms();
    setCustomTerms(refreshedTerms.join('\n'));
    showStatus('Saved custom terms');
  };

  return (
    <div style={{ maxWidth: '720px', margin: '24px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>Stet Settings</h1>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff', marginBottom: '18px' }}>
        <h2 style={{ marginTop: 0 }}>English Variant</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Choose between British and American English when English is active. This is a fine-grained option — the popup Language toggle switches between English and Chinese.
        </p>
        <div style={{ display: 'grid', gap: '12px' }}>
          {ENGLISH_VARIANTS.map((variant) => {
            const selected = language === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                disabled={loading}
                onClick={() => applyLanguage(variant.id)}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  border: selected ? '2px solid #2563eb' : '1px solid #d1d5db',
                  background: selected ? '#eff6ff' : '#fff',
                  cursor: loading ? 'default' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                  <strong>{variant.label}</strong>
                  {selected && <span style={{ color: '#2563eb', fontSize: '13px', fontWeight: 600 }}>Current</span>}
                </div>
                <div style={{ color: '#4b5563', marginTop: '6px', lineHeight: 1.45 }}>
                  {variant.description}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff', marginBottom: '18px' }}>
        <h2 style={{ marginTop: 0 }}>Custom Spellcheck Terms</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Add one accepted term per line. These entries are merged into the active spellcheck dictionary.
        </p>
        <textarea
          value={customTerms}
          onInput={(event) => setCustomTerms((event.currentTarget as HTMLTextAreaElement).value)}
          disabled={loading}
          placeholder={'organisation\nMinister Mentor'}
          style={{
            width: '100%',
            minHeight: '160px',
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
            onClick={saveTerms}
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
            Save custom terms
          </button>
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff' }}>
        <h2 style={{ marginTop: 0 }}>Site Scope</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Leave this list empty to run Stet on every site. Add hostnames here to run Stet only on those sites.
          Use one hostname per line, for example `cms.example.com` or `www.example.sg`.
        </p>
        <p style={{ color: '#6b7280', fontSize: '13px', lineHeight: 1.5 }}>
          If you want to block a single site while keeping Stet on everywhere else, Chrome also supports browser-level
          site access controls from Extensions {'>'} Stet Style Checker {'>'} This can read and change site data.
        </p>
        <textarea
          value={siteAllowlist}
          onInput={(event) => setSiteAllowlist((event.currentTarget as HTMLTextAreaElement).value)}
          disabled={loading}
          placeholder={'www.example.sg\ncms.example.com'}
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
            onClick={saveSiteScope}
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
            onClick={resetSiteScope}
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
          {statusMessage && <span style={{ color: '#16a34a', fontSize: '13px' }}>{statusMessage}</span>}
        </div>
      </section>
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
