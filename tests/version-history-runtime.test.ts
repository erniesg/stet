import { describe, expect, it } from 'vitest';
import { deriveEditableIdentity } from '../packages/extension/src/content/editable-target.js';
import { verifyRestoredContent } from '../packages/extension/src/content/version-history-core.js';
import { resolveHistoryRuntimeConfig } from '../packages/extension/src/history-settings.js';

describe('history runtime config', () => {
  it('disables history when the kill switch is active', () => {
    const runtime = resolveHistoryRuntimeConfig(
      { enabled: true, uiMode: 'page', debug: false, experimentalHosts: ['localhost'] },
      { hostname: 'localhost' },
      { disableHistory: true },
    );

    expect(runtime.enabled).toBe(false);
    expect(runtime.reason).toBe('runtime-kill-switch');
  });

  it('blocks field mode outside experimental hosts but keeps history enabled', () => {
    const runtime = resolveHistoryRuntimeConfig(
      { enabled: true, uiMode: 'field', debug: false, experimentalHosts: ['localhost'] },
      { hostname: 'cms.example.com' },
    );

    expect(runtime.enabled).toBe(true);
    expect(runtime.allowAnchoredUi).toBe(false);
    expect(runtime.reason).toBe('field-ui-host-blocked');
  });

  it('allows a local ui-mode override for test pages', () => {
    const runtime = resolveHistoryRuntimeConfig(
      { enabled: true, uiMode: 'page', debug: false, experimentalHosts: ['localhost'] },
      { hostname: 'localhost' },
      { uiModeOverride: 'field' },
    );

    expect(runtime.requestedUiMode).toBe('field');
    expect(runtime.allowAnchoredUi).toBe(true);
  });
});

describe('editable identity derivation', () => {
  it('prefers stable signals over DOM descriptor position', () => {
    const first = deriveEditableIdentity({
      url: 'https://cms.example.com/story/1',
      descriptor: 'div.editor-shell > div:nth-of-type(1) > textarea[name="body"]',
      label: 'Body',
      name: 'body',
      placeholder: 'Write story',
      containerHint: 'section[id="story-editor"]',
    });

    const remounted = deriveEditableIdentity({
      url: 'https://cms.example.com/story/1',
      descriptor: 'div.editor-shell > div:nth-of-type(2) > textarea[name="body"]',
      label: 'Body',
      name: 'body',
      placeholder: 'Write story',
      containerHint: 'section[id="story-editor"]',
    });

    expect(first.source).toBe('stable');
    expect(remounted.source).toBe('stable');
    expect(remounted.fieldKey).toBe(first.fieldKey);
    expect(remounted.descriptorKey).not.toBe(first.descriptorKey);
  });

  it('falls back to descriptor keys when no stable signals exist', () => {
    const first = deriveEditableIdentity({
      url: 'https://cms.example.com/story/1',
      descriptor: 'div:nth-of-type(1) > div:nth-of-type(3)',
      label: '',
    });

    const second = deriveEditableIdentity({
      url: 'https://cms.example.com/story/1',
      descriptor: 'div:nth-of-type(1) > div:nth-of-type(4)',
      label: '',
    });

    expect(first.source).toBe('descriptor');
    expect(second.source).toBe('descriptor');
    expect(first.fieldKey).not.toBe(second.fieldKey);
  });
});

describe('restore verification', () => {
  it('normalizes line endings before verification', () => {
    const verification = verifyRestoredContent('alpha\r\nbeta', 'alpha\nbeta');
    expect(verification.ok).toBe(true);
    expect(verification.changedChars).toBe(0);
  });

  it('reports mismatched restores', () => {
    const verification = verifyRestoredContent('alpha beta', 'alpha gamma');
    expect(verification.ok).toBe(false);
    expect(verification.changedChars).toBeGreaterThan(0);
  });
});
