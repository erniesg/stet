// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldInstallPageDebugBridge } from '../packages/extension/src/content/runtime.js';

describe('page debug bridge gating', () => {
  beforeEach(() => {
    delete window.__stetTraceCollectorEnabled;
    delete window.__stetHistoryDebugEnabled;
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    delete window.__stetTraceCollectorEnabled;
    delete window.__stetHistoryDebugEnabled;
    window.history.replaceState({}, '', '/');
  });

  it('stays disabled during normal runtime boot', () => {
    expect(shouldInstallPageDebugBridge()).toBe(false);
  });

  it('enables the bridge when the crash-isolation query flag is present', () => {
    window.history.replaceState({}, '', '/?stetDebug=history');
    expect(shouldInstallPageDebugBridge()).toBe(true);
  });

  it('enables the bridge when explicit history debug is turned on', () => {
    window.__stetHistoryDebugEnabled = true;
    expect(shouldInstallPageDebugBridge()).toBe(true);
  });

  it('enables the bridge when the trace collector flag is set', () => {
    window.__stetTraceCollectorEnabled = true;
    expect(shouldInstallPageDebugBridge()).toBe(true);
  });
});
