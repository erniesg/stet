import { describe, expect, it } from 'vitest';
import { deriveEditableIdentity } from '../packages/extension/src/content/editable-target.js';
import { verifyRestoredContent } from '../packages/extension/src/content/version-history-core.js';
import { resolveHistoryRuntimeConfig } from '../packages/extension/src/history-settings.js';

describe('history runtime config', () => {
  it('disables history when the kill switch is active', () => {
    const runtime = resolveHistoryRuntimeConfig(
      { enabled: true, uiMode: 'field', debug: false, experimentalHosts: ['localhost'] },
      { hostname: 'localhost' },
      { disableHistory: true },
    );

    expect(runtime.enabled).toBe(false);
    expect(runtime.reason).toBe('runtime-kill-switch');
  });

  it('disables history outside configured experimental hosts', () => {
    const runtime = resolveHistoryRuntimeConfig(
      { enabled: true, uiMode: 'field', debug: false, experimentalHosts: ['localhost'] },
      { hostname: 'cms.example.com' },
    );

    expect(runtime.enabled).toBe(false);
    expect(runtime.reason).toBe('host-not-allowed');
  });

  it('allows field mode on configured experimental hosts', () => {
    const runtime = resolveHistoryRuntimeConfig(
      { enabled: true, uiMode: 'field', debug: false, experimentalHosts: ['cms.example.com'] },
      { hostname: 'cms.example.com' },
    );

    expect(runtime.enabled).toBe(true);
    expect(runtime.requestedUiMode).toBe('field');
    expect(runtime.allowAnchoredUi).toBe(true);
    expect(runtime.reason).toBeNull();
  });

  it('defaults to field mode for new installs on any host', () => {
    const runtime = resolveHistoryRuntimeConfig(
      null,
      { hostname: 'mail.google.com' },
    );

    expect(runtime.enabled).toBe(true);
    expect(runtime.requestedUiMode).toBe('field');
    expect(runtime.allowAnchoredUi).toBe(true);
  });

  it('migrates the legacy hidden page default to field mode', () => {
    const runtime = resolveHistoryRuntimeConfig(
      {
        enabled: true,
        uiMode: 'page',
        debug: false,
        experimentalHosts: ['localhost', '127.0.0.1'],
      },
      { hostname: 'localhost' },
    );

    expect(runtime.requestedUiMode).toBe('field');
    expect(runtime.allowAnchoredUi).toBe(true);
  });

  it('normalizes stored page mode back to field mode in non-debug runtime', () => {
    const runtime = resolveHistoryRuntimeConfig(
      {
        enabled: true,
        uiMode: 'page',
        debug: false,
        experimentalHosts: ['cms.example.com'],
      },
      { hostname: 'cms.example.com' },
    );

    expect(runtime.enabled).toBe(true);
    expect(runtime.requestedUiMode).toBe('field');
    expect(runtime.allowAnchoredUi).toBe(true);
  });

  it('normalizes stored page mode to field mode even when history debug is enabled', () => {
    const runtime = resolveHistoryRuntimeConfig(
      {
        enabled: true,
        uiMode: 'page',
        debug: true,
        experimentalHosts: ['cms.example.com'],
      },
      { hostname: 'cms.example.com' },
    );

    expect(runtime.enabled).toBe(true);
    expect(runtime.requestedUiMode).toBe('field');
    expect(runtime.allowAnchoredUi).toBe(true);
  });

  it('normalizes an explicit page override back to field mode', () => {
    const runtime = resolveHistoryRuntimeConfig(
      {
        enabled: true,
        uiMode: 'field',
        debug: false,
        experimentalHosts: ['localhost'],
      },
      { hostname: 'localhost' },
      { uiModeOverride: 'page' },
    );

    expect(runtime.enabled).toBe(true);
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

  it('ignores remount-only wrapper churn when stronger semantic signals exist', () => {
    const first = deriveEditableIdentity({
      url: 'https://cms.example.com/story/1',
      descriptor: 'section#story-editor > div.editor-shell > div#body-a',
      label: 'Body',
      id: 'body-a',
      ariaLabel: 'Story body',
      dataTestId: 'story-body',
      containerHint: 'section#story-editor > div.editor-shell',
    });

    const remounted = deriveEditableIdentity({
      url: 'https://cms.example.com/story/1',
      descriptor: 'section#story-editor > div.editor-shell.remounted > div#body-b',
      label: 'Body',
      id: 'body-b',
      ariaLabel: 'Story body',
      dataTestId: 'story-body',
      containerHint: 'section#story-editor > div.editor-shell.remounted',
    });

    expect(remounted.source).toBe('stable');
    expect(remounted.fieldKey).toBe(first.fieldKey);
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
