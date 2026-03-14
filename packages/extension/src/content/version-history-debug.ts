import type { EditableTarget } from './editable-target.js';

const MAX_DEBUG_ENTRIES = 120;
const RATE_LOG_INTERVAL_MS = 10_000;
const BEACON_TRACE_ENDPOINT = 'http://127.0.0.1:5123/trace';

interface HistoryEventRate {
  count: number;
  startedAt: number;
}

export interface HistoryDebugEntry {
  event: string;
  timestamp: string;
  href: string;
  data: Record<string, unknown>;
}

interface HistoryDebugSyncPayload {
  href: string;
  updatedAt: string;
  entries: HistoryDebugEntry[];
}

interface TraceEventPayload {
  event: string;
  timestamp: string;
  href: string;
  data: Record<string, unknown>;
}

declare global {
  interface Window {
    __stetDisableHistory?: boolean;
    __stetHistoryDebug?: HistoryDebugEntry[];
    __stetHistoryDebugEnabled?: boolean;
    __stetTraceCollectorEnabled?: boolean;
    __stetHistoryUiMode?: 'off' | 'page' | 'field';
  }
}

/**
 * Sequence counter so traces have a guaranteed ordering even when
 * timestamps collide (sub-ms resolution or batched events).
 */
let beaconSeq = 0;

const eventRates = new Map<string, HistoryEventRate>();
let debugSyncTimer: number | null = null;
let lastSyncedMarker = '';

export function isHistoryRuntimeDisabled(): boolean {
  return window.__stetDisableHistory === true;
}

export function isHistoryDebugEnabled(configDebug: boolean): boolean {
  return configDebug || window.__stetHistoryDebugEnabled === true;
}

export function logHistoryEvent(
  event: string,
  data: Record<string, unknown> = {},
  options: { debug?: boolean; level?: 'debug' | 'warn' } = {},
) {
  const entry: HistoryDebugEntry = {
    event,
    timestamp: new Date().toISOString(),
    href: window.location.href,
    data,
  };

  const buffer = window.__stetHistoryDebug ?? [];
  buffer.push(entry);
  if (buffer.length > MAX_DEBUG_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_DEBUG_ENTRIES);
  }
  window.__stetHistoryDebug = buffer;

  if (event === 'history:error') {
    syncHistoryDebugBuffer(true);
  } else {
    scheduleHistoryDebugBufferSync();
  }

  emitTraceEvent({
    event,
    timestamp: entry.timestamp,
    href: entry.href,
    data: entry.data,
  });

  if (!options.debug) return;

  const consoleMethod = options.level === 'warn' ? console.warn : console.debug;
  consoleMethod(`[stet] ${event}`, data);
}

export function recordHistoryEventRate(
  eventName: string,
  data: Record<string, unknown> = {},
  debug = false,
) {
  const now = getNow();
  const current = eventRates.get(eventName);

  if (!current) {
    eventRates.set(eventName, { count: 1, startedAt: now });
    return;
  }

  current.count += 1;

  const elapsedMs = now - current.startedAt;
  if (elapsedMs < RATE_LOG_INTERVAL_MS) return;

  logHistoryEvent('history:event-rate', {
    eventName,
    count: current.count,
    elapsedMs: roundMs(elapsedMs),
    ...data,
  }, { debug });

  eventRates.set(eventName, { count: 0, startedAt: now });
}

export function flushHistoryEventRates(debug = false) {
  const now = getNow();

  for (const [eventName, current] of eventRates) {
    if (current.count === 0) continue;
    logHistoryEvent('history:event-rate', {
      eventName,
      count: current.count,
      elapsedMs: roundMs(now - current.startedAt),
    }, { debug });
  }

  eventRates.clear();
}

export function getHistoryTargetLogData(target: EditableTarget): Record<string, unknown> {
  const rect = target.element.getBoundingClientRect();

  return {
    fieldKey: target.fieldKey,
    label: target.label,
    descriptor: target.descriptor,
    kind: target.kind,
    identitySource: target.identity.source,
    stableKey: target.identity.stableKey,
    rect: {
      top: roundPx(rect.top),
      left: roundPx(rect.left),
      width: roundPx(rect.width),
      height: roundPx(rect.height),
    },
  };
}

export function getElapsedMs(startedAt: number): number {
  return roundMs(getNow() - startedAt);
}

export function getNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function getHistoryErrorLogData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    message: typeof error === 'string' ? error : String(error),
  };
}

function scheduleHistoryDebugBufferSync() {
  if (debugSyncTimer !== null) return;

  debugSyncTimer = window.setTimeout(() => {
    debugSyncTimer = null;
    syncHistoryDebugBuffer();
  }, 1000);
}

function syncHistoryDebugBuffer(force = false) {
  const entries = [...(window.__stetHistoryDebug ?? [])];
  if (entries.length === 0) return;

  const lastEntry = entries[entries.length - 1];
  const marker = `${entries.length}:${lastEntry.timestamp}:${lastEntry.event}`;
  if (!force && marker === lastSyncedMarker) return;
  lastSyncedMarker = marker;

  const payload: HistoryDebugSyncPayload = {
    href: window.location.href,
    updatedAt: new Date().toISOString(),
    entries,
  };

  try {
    chrome.runtime.sendMessage({
      type: 'SYNC_HISTORY_DEBUG_BUFFER',
      payload,
    }, () => {
      void chrome.runtime.lastError;
    });
  } catch {}
}

function emitTraceEvent(payload: TraceEventPayload) {
  // Primary: sendBeacon — survives renderer crashes
  beaconTrace(payload);

  // Secondary: extension message — for service-worker storage
  try {
    chrome.runtime.sendMessage({
      type: 'TRACE_EVENT',
      source: 'history',
      entry: payload,
    }, () => {
      void chrome.runtime.lastError;
    });
  } catch {}
}

/**
 * Fire-and-forget trace via navigator.sendBeacon.
 * Uses text/plain content type to avoid CORS preflight — the browser
 * will always dispatch the request even if the renderer crashes
 * immediately after this call.
 */
function beaconTrace(payload: TraceEventPayload) {
  try {
    if (!shouldBeaconTrace()) return;
    if (typeof navigator?.sendBeacon !== 'function') return;

    const body = JSON.stringify({
      seq: beaconSeq++,
      source: 'beacon',
      ...payload,
    });

    // text/plain avoids CORS preflight — guaranteed delivery
    const blob = new Blob([body], { type: 'text/plain' });
    navigator.sendBeacon(BEACON_TRACE_ENDPOINT, blob);
  } catch {
    // Swallow — tracing must never break the host page
  }
}

function shouldBeaconTrace(): boolean {
  if (window.__stetTraceCollectorEnabled === true) return true;

  try {
    const params = new URLSearchParams(window.location.search);
    return params.has('stetDebug');
  } catch {
    return false;
  }
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPx(value: number): number {
  return Math.round(value * 10) / 10;
}
