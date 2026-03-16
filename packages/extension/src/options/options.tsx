import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadCustomTerms, saveCustomTerms } from '../content/dictionary-loader.js';
import { formatSiteAllowlist, parseSiteAllowlistInput } from '../host-access.js';
import { detectProfileId, listProfiles } from '../storage/profiles.js';

const profiles = listProfiles();

function Options() {
  const [profileId, setProfileId] = useState<string>('custom');
  const [siteAllowlist, setSiteAllowlist] = useState('');
  const [customTerms, setCustomTerms] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_RAW_SETTINGS' }, async (resp) => {
      setProfileId(detectProfileId(resp?.resolvedConfig) ?? 'custom');
      setSiteAllowlist(formatSiteAllowlist(resp?.userOverrides?.siteAllowlist));
      setCustomTerms((await loadCustomTerms()).join('\n'));
      setLoading(false);
    });
  }, []);

  const showStatus = (message: string) => {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(null), 1800);
  };

  const applyProfile = (nextProfileId: string) => {
    chrome.runtime.sendMessage({
      type: 'APPLY_PROFILE',
      profileId: nextProfileId,
    }, () => {
      setProfileId(nextProfileId);
      showStatus(`Applied ${profiles.find(profile => profile.id === nextProfileId)?.name ?? nextProfileId}`);
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
        <h2 style={{ marginTop: 0 }}>Profile</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Choose a bundled newsroom preset. Zaobao switches Stet to `zh-SG` and limits the common pack to spellcheck so English readability rules stay out of Chinese copy.
        </p>
        <div style={{ display: 'grid', gap: '12px' }}>
          {profiles.map((profile) => {
            const selected = profileId === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                disabled={loading}
                onClick={() => applyProfile(profile.id)}
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
                  <strong>{profile.name}</strong>
                  {selected && <span style={{ color: '#2563eb', fontSize: '13px', fontWeight: 600 }}>Current</span>}
                </div>
                <div style={{ color: '#4b5563', marginTop: '6px', lineHeight: 1.45 }}>
                  {profile.description}
                </div>
                {profile.suggestedHosts.length > 0 && (
                  <div style={{ color: '#6b7280', marginTop: '8px', fontSize: '13px' }}>
                    Suggested hosts: {profile.suggestedHosts.join(', ')}
                  </div>
                )}
              </button>
            );
          })}
          {profileId === 'custom' && (
            <div style={{ color: '#6b7280', fontSize: '13px' }}>
              Current config does not exactly match a bundled preset.
            </div>
          )}
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff', marginBottom: '18px' }}>
        <h2 style={{ marginTop: 0 }}>Custom Spellcheck Terms</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Add one accepted term per line. These entries are merged into the active spellcheck dictionary, including the Zaobao `zh-SG` profile.
        </p>
        <textarea
          value={customTerms}
          onInput={(event) => setCustomTerms((event.currentTarget as HTMLTextAreaElement).value)}
          disabled={loading}
          placeholder={'巴士转换站\n德士\n组屋区'}
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
          Use one hostname per line, for example `cms.example.com` or `www.zaobao.com.sg`.
        </p>
        <p style={{ color: '#6b7280', fontSize: '13px', lineHeight: 1.5 }}>
          If you want to block a single site while keeping Stet on everywhere else, Chrome also supports browser-level
          site access controls from Extensions {'>'} Stet Style Checker {'>'} This can read and change site data.
        </p>
        <textarea
          value={siteAllowlist}
          onInput={(event) => setSiteAllowlist((event.currentTarget as HTMLTextAreaElement).value)}
          disabled={loading}
          placeholder={'www.zaobao.com.sg\ncms.example.com'}
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
