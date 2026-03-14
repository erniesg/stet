// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logHistoryEvent } from '../packages/extension/src/content/version-history-debug.js';

describe('history debug console formatting', () => {
  beforeEach(() => {
    window.__stetHistoryDebug = [];
  });

  afterEach(() => {
    window.__stetHistoryDebug = [];
    vi.restoreAllMocks();
  });

  it('formats page debug events without dumping [object Object]', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    logHistoryEvent('page:debug', {
      pageEventType: 'console-warn',
      payload: {
        args: ['ProseMirror expects the CSS white-space property to be set.'],
      },
    }, { debug: true });

    expect(debugSpy).toHaveBeenCalledWith(
      '[stet] page:debug console-warn ProseMirror expects the CSS white-space property to be set.',
    );
  });

  it('formats history errors using the message field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logHistoryEvent('history:error', {
      message: 'Could not verify restored content.',
    }, { debug: true, level: 'warn' });

    expect(warnSpy).toHaveBeenCalledWith(
      '[stet] history:error Could not verify restored content.',
    );
  });
});
