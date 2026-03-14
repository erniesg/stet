import type { OnDictionaryLoaded } from './checker.js';
import { initChecker } from './checker.js';
import { initVersionHistory } from './version-history-manager.js';
import {
  getHistoryErrorLogData,
  isHistoryDebugEnabled,
  logHistoryEvent,
} from './version-history-debug.js';
import { isHostAllowed } from '../host-access.js';

export interface ContentRuntimeOptions {
  registerPacks?: () => void;
  onDictionaryLoaded?: OnDictionaryLoaded;
}

declare global {
  interface Window {
    __stetContentRuntime?: {
      initialized: boolean;
      bootCount: number;
      skipReason: string | null;
    };
    __stetPageDebugRelayInstalled?: boolean;
  }
}

export function bootContentRuntime(options: ContentRuntimeOptions = {}) {
  const runtime = (window.__stetContentRuntime ??= {
    initialized: false,
    bootCount: 0,
    skipReason: null,
  });

  runtime.bootCount += 1;
  logHistoryEvent('content:boot', {
    bootCount: runtime.bootCount,
    hostname: window.location.hostname,
  });

  if (window !== window.top) {
    runtime.skipReason = 'subframe';
    logHistoryEvent('content:skip', {
      reason: runtime.skipReason,
      hostname: window.location.hostname,
    });
    console.debug('[stet] Skipping subframe content bootstrap');
    return;
  }

  if (runtime.initialized) {
    runtime.skipReason = 'duplicate';
    logHistoryEvent('content:skip', {
      reason: runtime.skipReason,
      hostname: window.location.hostname,
    });
    console.warn('[stet] Duplicate content bootstrap skipped');
    return;
  }

  runtime.initialized = true;
  runtime.skipReason = null;

  void startContentRuntime(runtime, options);
}

function registerGlobalHistoryCrashHandlers() {
  window.addEventListener('error', (event) => {
    logHistoryEvent('history:error', {
      source: 'window-error',
      filename: event.filename || null,
      lineno: event.lineno || null,
      colno: event.colno || null,
      ...getHistoryErrorLogData(event.error ?? event.message),
    }, {
      debug: isHistoryDebugEnabled(false),
      level: 'warn',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logHistoryEvent('history:error', {
      source: 'unhandledrejection',
      ...getHistoryErrorLogData(event.reason),
    }, {
      debug: isHistoryDebugEnabled(false),
      level: 'warn',
    });
  });
}

/**
 * Read the ?stetDebug= URL parameter for subsystem isolation.
 *   all     — run both checker and history (default)
 *   checker — run checker only, skip history
 *   history — run history only, skip checker
 *   none    — skip both (baseline test)
 */
function getIsolationMode(): 'all' | 'checker' | 'history' | 'none' {
  try {
    const param = new URLSearchParams(window.location.search).get('stetDebug');
    if (param === 'checker' || param === 'history' || param === 'none') return param;
  } catch {}
  return 'all';
}

async function startContentRuntime(
  runtime: NonNullable<Window['__stetContentRuntime']>,
  options: ContentRuntimeOptions,
) {
  const isolation = getIsolationMode();
  const allowed = await isCurrentHostAllowed();
  logHistoryEvent('content:host-check', {
    hostname: window.location.hostname,
    allowed,
    isolation,
  });
  if (!allowed) {
    runtime.skipReason = 'host-not-allowed';
    logHistoryEvent('content:skip', {
      reason: runtime.skipReason,
      hostname: window.location.hostname,
    });
    console.debug('[stet] Content runtime skipped on host', window.location.hostname);
    return;
  }

  logHistoryEvent('content:start', {
    hostname: window.location.hostname,
    isolation,
  });
  registerGlobalHistoryCrashHandlers();
  registerPageDebugRelay();
  injectPageDebugBridge();
  options.registerPacks?.();

  const runChecker = isolation === 'all' || isolation === 'checker';
  const runHistory = isolation === 'all' || isolation === 'history';

  if (runChecker) {
    logHistoryEvent('content:init-checker', { isolation });
    void initChecker(options.onDictionaryLoaded);
  } else {
    logHistoryEvent('content:skip-checker', { isolation });
  }

  if (runHistory) {
    logHistoryEvent('content:init-history', { isolation });
    void initVersionHistory();
  } else {
    logHistoryEvent('content:skip-history', { isolation });
  }
}

async function isCurrentHostAllowed(): Promise<boolean> {
  try {
    const config = await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve((resp?.config ?? null) as Record<string, unknown> | null);
      });
    });

    return isHostAllowed(
      window.location.hostname,
      Array.isArray(config?.siteAllowlist) ? config.siteAllowlist : undefined,
    );
  } catch {
    return isHostAllowed(window.location.hostname);
  }
}

function registerPageDebugRelay() {
  if (window.__stetPageDebugRelayInstalled) return;
  window.__stetPageDebugRelayInstalled = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'stet-page-debug') return;

    const payload = {
      pageEventType: event.data.type ?? 'unknown',
      href: typeof event.data.href === 'string' ? event.data.href : window.location.href,
      timestamp: typeof event.data.timestamp === 'string' ? event.data.timestamp : new Date().toISOString(),
      payload: typeof event.data.payload === 'object' && event.data.payload !== null ? event.data.payload : {},
    };

    logHistoryEvent('page:debug', payload, {
      debug: true,
      level: event.data.type === 'console-error' || event.data.type === 'window-error'
        ? 'warn'
        : 'debug',
    });

    try {
      chrome.runtime.sendMessage({
        type: 'PAGE_DEBUG_EVENT',
        event: payload,
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
  });
}

function injectPageDebugBridge() {
  if (document.getElementById('stet-page-debug-bridge')) return;

  const script = document.createElement('script');
  script.id = 'stet-page-debug-bridge';
  script.src = chrome.runtime.getURL('page-debug-bridge.js');
  script.async = false;
  script.addEventListener('load', () => {
    script.remove();
  });
  script.addEventListener('error', () => {
    logHistoryEvent('history:error', {
      source: 'inject-page-debug-bridge',
      src: script.src,
    }, {
      debug: true,
      level: 'warn',
    });
    script.remove();
  });

  (document.head ?? document.documentElement).appendChild(script);
}
