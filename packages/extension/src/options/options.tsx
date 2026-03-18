import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadCustomTerms, saveCustomTerms } from '../content/dictionary-loader.js';
import { formatSiteAllowlist, parseSiteAllowlistInput } from '../host-access.js';
import {
  getActiveProfileId,
  getProfileLanguage,
  listLanguageOptions,
  listProfiles,
  resolveLanguageSetting,
} from '../storage/profiles.js';

const profiles = listProfiles();
const languageOptions = listLanguageOptions();
type LanguageSetting = typeof languageOptions[number]['id'];

function Options() {
  const [profileId, setProfileId] = useState<string>('standard');
  const [language, setLanguage] = useState<LanguageSetting>('base');
  const [profileLanguage, setProfileLanguage] = useState<'en-GB' | 'en-US' | 'zh-SG'>('en-GB');
  const [siteAllowlist, setSiteAllowlist] = useState('');
  const [customTerms, setCustomTerms] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfigState = () => {
    chrome.runtime.sendMessage({ type: 'GET_RAW_SETTINGS' }, (resp) => {
      const nextProfileId = getActiveProfileId(resp?.userOverrides?.profileId, resp?.resolvedConfig);
      const nextProfileLanguage = getProfileLanguage(resp?.resolvedConfig ?? null, nextProfileId);
      const nextLanguage = resolveLanguageSetting(resp?.userOverrides?.language, nextProfileLanguage);

      setProfileId(nextProfileId);
      setProfileLanguage(nextProfileLanguage);
      setLanguage(nextLanguage);
      setSiteAllowlist(formatSiteAllowlist(resp?.userOverrides?.siteAllowlist));
      setLoading(false);

      if (resp?.userOverrides?.language && nextLanguage === 'base') {
        chrome.runtime.sendMessage({
          type: 'UPDATE_USER_OVERRIDES',
          overrides: { language: undefined },
        });
      }
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

  const applyProfile = (nextProfileId: string) => {
    chrome.runtime.sendMessage({
      type: 'APPLY_PROFILE',
      profileId: nextProfileId,
    }, () => {
      loadConfigState();
      showStatus(`Applied ${profiles.find(profile => profile.id === nextProfileId)?.name ?? nextProfileId}`);
    });
  };

  const applyLanguage = (nextLanguage: LanguageSetting) => {
    const explicitLanguage = nextLanguage === 'base' || nextLanguage === profileLanguage
      ? undefined
      : nextLanguage;

    chrome.runtime.sendMessage({
      type: 'UPDATE_USER_OVERRIDES',
      overrides: {
        language: explicitLanguage,
      },
    }, () => {
      setLanguage(resolveLanguageSetting(explicitLanguage, profileLanguage));
      showStatus(explicitLanguage ? `Forced ${explicitLanguage}` : `Following profile language (${profileLanguage})`);
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
          Choose a demo preset without replacing the underlying newsroom config. Singapore Chinese keeps the current build or tenant setup, but switches the checker to zh-SG spellcheck-only mode.
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
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff', marginBottom: '18px' }}>
        <h2 style={{ marginTop: 0 }}>Language</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Override the active language for demos. <code>Auto</code> follows the selected profile and is currently <code>{profileLanguage}</code>.
        </p>
        <div style={{ display: 'grid', gap: '12px' }}>
          {languageOptions.map((option) => {
            const selected = language === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={loading}
                onClick={() => applyLanguage(option.id)}
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
                  <strong>{option.label}</strong>
                  {selected && <span style={{ color: '#2563eb', fontSize: '13px', fontWeight: 600 }}>Current</span>}
                </div>
                <div style={{ color: '#4b5563', marginTop: '6px', lineHeight: 1.45 }}>
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '18px', background: '#fff', marginBottom: '18px' }}>
        <h2 style={{ marginTop: 0 }}>Custom Spellcheck Terms</h2>
        <p style={{ color: '#4b5563', lineHeight: 1.5 }}>
          Add one accepted term per line. These entries are merged into the active spellcheck dictionary, including the Singapore Chinese `zh-SG` demo profile and any manual language override.
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
