import type { EditableTarget } from './editable-target.js';

const MAX_DEBUG_ENTRIES = 120;
const RATE_LOG_INTERVAL_MS = 10_000;

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

declare global {
  interface Window {
    __stetDisableHistory?: boolean;
    __stetHistoryDebug?: HistoryDebugEntry[];
    __stetHistoryDebugEnabled?: boolean;
    __stetHistoryUiMode?: 'off' | 'page' | 'field';
  }
}

const eventRates = new Map<string, HistoryEventRate>();

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

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPx(value: number): number {
  return Math.round(value * 10) / 10;
}
