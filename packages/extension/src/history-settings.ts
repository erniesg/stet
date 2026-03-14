import { isHostAllowed } from './host-access.js';

export type HistoryUiMode = 'off' | 'page' | 'field';

export interface HistorySettings {
  enabled: boolean;
  uiMode: HistoryUiMode;
  debug: boolean;
  experimentalHosts: string[];
}

export interface HistoryRuntimeConfig {
  enabled: boolean;
  requestedUiMode: HistoryUiMode;
  allowAnchoredUi: boolean;
  debug: boolean;
  reason: string | null;
}

export interface HistoryRuntimeOverrides {
  disableHistory?: boolean;
  debug?: boolean;
  uiModeOverride?: HistoryUiMode;
}

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  enabled: true,
  uiMode: 'field',
  debug: false,
  experimentalHosts: [],
};

export function normalizeHistorySettings(
  settings?: Partial<HistorySettings> | null,
): HistorySettings {
  const debug = settings?.debug ?? DEFAULT_HISTORY_SETTINGS.debug;
  const experimentalHosts = normalizeHosts(settings?.experimentalHosts);

  return {
    enabled: settings?.enabled ?? DEFAULT_HISTORY_SETTINGS.enabled,
    uiMode: normalizeStoredUiMode(settings?.uiMode, debug),
    debug,
    experimentalHosts,
  };
}

export function resolveHistoryRuntimeConfig(
  settings: Partial<HistorySettings> | null | undefined,
  context: { hostname: string },
  runtime: HistoryRuntimeOverrides = {},
): HistoryRuntimeConfig {
  const normalized = normalizeHistorySettings(settings);
  const requestedUiMode = runtime.uiModeOverride
    ? normalizeUiMode(runtime.uiModeOverride)
    : normalized.uiMode;
  const debug = normalized.debug || runtime.debug === true;

  if (runtime.disableHistory) {
    return {
      enabled: false,
      requestedUiMode,
      allowAnchoredUi: false,
      debug,
      reason: 'runtime-kill-switch',
    };
  }

  if (!normalized.enabled || requestedUiMode === 'off') {
    return {
      enabled: false,
      requestedUiMode,
      allowAnchoredUi: false,
      debug,
      reason: normalized.enabled ? 'ui-mode-off' : 'settings-disabled',
    };
  }

  if (!isHostAllowed(context.hostname, normalized.experimentalHosts)) {
    return {
      enabled: false,
      requestedUiMode,
      allowAnchoredUi: false,
      debug,
      reason: 'host-not-allowed',
    };
  }

  const allowAnchoredUi = requestedUiMode === 'field';

  return {
    enabled: true,
    requestedUiMode,
    allowAnchoredUi,
    debug,
    reason: null,
  };
}

function normalizeUiMode(value: HistoryUiMode | undefined): HistoryUiMode {
  if (value === 'off' || value === 'field') return value;
  if (value === 'page') return 'field';
  return DEFAULT_HISTORY_SETTINGS.uiMode;
}

function normalizeHosts(value: string[] | undefined): string[] {
  const unique = new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

  return [...unique];
}

function normalizeStoredUiMode(
  value: HistoryUiMode | undefined,
  _debug: boolean,
): HistoryUiMode {
  return normalizeUiMode(value);
}
