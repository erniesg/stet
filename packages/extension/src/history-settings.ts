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
  uiMode: 'page',
  debug: false,
  experimentalHosts: ['localhost', '127.0.0.1'],
};

export function normalizeHistorySettings(
  settings?: Partial<HistorySettings> | null,
): HistorySettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_HISTORY_SETTINGS.enabled,
    uiMode: normalizeUiMode(settings?.uiMode),
    debug: settings?.debug ?? DEFAULT_HISTORY_SETTINGS.debug,
    experimentalHosts: normalizeHosts(settings?.experimentalHosts),
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

  const allowAnchoredUi =
    requestedUiMode === 'field' &&
    normalized.experimentalHosts.includes(context.hostname.trim().toLowerCase());

  return {
    enabled: true,
    requestedUiMode,
    allowAnchoredUi,
    debug,
    reason:
      requestedUiMode === 'field' && !allowAnchoredUi
        ? 'field-ui-host-blocked'
        : null,
  };
}

function normalizeUiMode(value: HistoryUiMode | undefined): HistoryUiMode {
  if (value === 'off' || value === 'field' || value === 'page') return value;
  return DEFAULT_HISTORY_SETTINGS.uiMode;
}

function normalizeHosts(value: string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : DEFAULT_HISTORY_SETTINGS.experimentalHosts;
  const unique = new Set(
    raw
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

  if (unique.size === 0) {
    DEFAULT_HISTORY_SETTINGS.experimentalHosts.forEach((host) => unique.add(host));
  }

  return [...unique];
}
