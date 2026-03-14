import type { EditableTarget } from './editable-target.js';
import {
  getElapsedMs,
  getHistoryTargetLogData,
  getNow,
  logHistoryEvent,
} from './version-history-debug.js';
import {
  DEFAULT_HISTORY_POLICY,
  createSnapshot,
  estimateRecordBytes,
  pruneSnapshots,
  shouldSaveSnapshot,
  type EditableHistoryRecord,
  type HistoryPolicy,
  type SnapshotSource,
} from './version-history-core.js';

interface HistoryIndexEntry {
  updatedAt: string;
  estimatedBytes: number;
  label: string;
  url: string;
  kind: EditableHistoryRecord['kind'];
  descriptorKey?: string;
  stableKey?: string | null;
}

type HistoryIndex = Record<string, HistoryIndexEntry>;

const HISTORY_INDEX_KEY = 'stet:history:index';

export async function loadHistoryRecord(storageKey: string): Promise<EditableHistoryRecord | null> {
  const stored = await storageGet<EditableHistoryRecord | undefined>(storageKey);
  return stored ?? null;
}

export async function loadHistoryRecordForTarget(
  target: EditableTarget,
  debug = false,
): Promise<EditableHistoryRecord | null> {
  const startedAt = getNow();
  const direct = await loadHistoryRecord(target.storageKey);

  if (direct) {
    const normalizedDirect = recordNeedsNormalization(direct, target)
      ? normalizeRecordForTarget(direct, target)
      : direct;

    if (normalizedDirect !== direct) {
      await persistHistoryRecord(target.storageKey, normalizedDirect, DEFAULT_HISTORY_POLICY);
    }

    logHistoryEvent('history:load', {
      ...getHistoryTargetLogData(target),
      storageKey: target.storageKey,
      direct: true,
      elapsedMs: getElapsedMs(startedAt),
    }, { debug });
    return normalizedDirect;
  }

  const alias = await findHistoryRecordAlias(target);
  if (!alias) {
    logHistoryEvent('history:load', {
      ...getHistoryTargetLogData(target),
      storageKey: target.storageKey,
      direct: false,
      found: false,
      elapsedMs: getElapsedMs(startedAt),
    }, { debug });
    return null;
  }

  const migratedRecord = normalizeRecordForTarget(alias.record, target);
  await persistHistoryRecord(target.storageKey, migratedRecord, DEFAULT_HISTORY_POLICY, [alias.storageKey]);

  logHistoryEvent('history:load', {
    ...getHistoryTargetLogData(target),
    storageKey: target.storageKey,
    migratedFrom: alias.storageKey,
    matchReason: alias.matchReason,
    direct: false,
    elapsedMs: getElapsedMs(startedAt),
  }, { debug });

  return migratedRecord;
}

export async function saveSnapshotForTarget(
  target: EditableTarget,
  text: string,
  source: SnapshotSource,
  policy: HistoryPolicy = DEFAULT_HISTORY_POLICY,
  force = false,
  debug = false,
): Promise<EditableHistoryRecord | null> {
  const startedAt = getNow();
  const normalizedText = text.replace(/\r\n/g, '\n');
  if (normalizedText.length > policy.maxSnapshotChars) {
    logHistoryEvent('history:save-skip', {
      ...getHistoryTargetLogData(target),
      source,
      reason: 'oversize',
      maxSnapshotChars: policy.maxSnapshotChars,
      actualChars: normalizedText.length,
    }, { debug, level: 'warn' });
    return loadHistoryRecordForTarget(target, debug);
  }

  const direct = await loadHistoryRecord(target.storageKey);
  const alias = direct ? null : await findHistoryRecordAlias(target);
  const existing = direct
    ? normalizeRecordForTarget(direct, target)
    : alias
      ? normalizeRecordForTarget(alias.record, target)
      : null;
  const latest = existing?.snapshots.at(-1);

  if (!shouldSaveSnapshot(latest, normalizedText, policy, { force })) {
    logHistoryEvent('history:save-skip', {
      ...getHistoryTargetLogData(target),
      source,
      reason: 'policy',
      force,
      elapsedMs: getElapsedMs(startedAt),
    }, { debug });
    return existing;
  }

  const now = new Date();
  const snapshot = createSnapshot(latest?.content ?? '', normalizedText, source, policy, now);

  const record: EditableHistoryRecord = {
    fieldKey: target.fieldKey,
    label: target.label,
    descriptor: target.descriptor,
    kind: target.kind,
    url: target.url,
    identity: target.identity,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    snapshots: pruneSnapshots([...(existing?.snapshots ?? []), snapshot], policy, now.getTime()),
  };

  await persistHistoryRecord(
    target.storageKey,
    record,
    policy,
    alias && alias.storageKey !== target.storageKey ? [alias.storageKey] : [],
  );

  logHistoryEvent('history:save', {
    ...getHistoryTargetLogData(target),
    source,
    force,
    versions: record.snapshots.length,
    storageKey: target.storageKey,
    migratedFrom: alias?.storageKey ?? null,
    elapsedMs: getElapsedMs(startedAt),
  }, { debug });

  return record;
}

async function persistHistoryRecord(
  storageKey: string,
  record: EditableHistoryRecord,
  policy: HistoryPolicy,
  keysToRemove: string[] = [],
): Promise<void> {
  const nextIndex = {
    ...(await storageGet<HistoryIndex | undefined>(HISTORY_INDEX_KEY) ?? {}),
    [storageKey]: {
      updatedAt: record.updatedAt,
      estimatedBytes: estimateRecordBytes(record),
      label: record.label,
      url: record.url,
      kind: record.kind,
      descriptorKey: record.identity?.descriptorKey,
      stableKey: record.identity?.stableKey ?? null,
    },
  };

  keysToRemove.forEach((key) => {
    delete nextIndex[key];
  });

  const pruned = pruneIndex(nextIndex, storageKey, policy);
  const prunedKeysToRemove = [
    ...keysToRemove,
    ...Object.keys(nextIndex).filter((key) => !(key in pruned)),
  ];

  await storageSet({
    [storageKey]: record,
    [HISTORY_INDEX_KEY]: pruned,
  });

  if (prunedKeysToRemove.length > 0) {
    await storageRemove([...new Set(prunedKeysToRemove)]);
  }
}

function pruneIndex(
  index: HistoryIndex,
  protectedKey: string,
  policy: HistoryPolicy,
): HistoryIndex {
  const entries = Object.entries(index)
    .sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt));

  const kept: HistoryIndex = {};
  let totalBytes = 0;

  for (const [key, value] of entries) {
    const withinFieldLimit = Object.keys(kept).length < policy.maxTrackedFields;
    const withinByteLimit = totalBytes + value.estimatedBytes <= policy.maxTotalBytes;

    if (key === protectedKey || (withinFieldLimit && withinByteLimit)) {
      kept[key] = value;
      totalBytes += value.estimatedBytes;
    }
  }

  if (!(protectedKey in kept)) {
    kept[protectedKey] = index[protectedKey];
  }

  return kept;
}

async function findHistoryRecordAlias(target: EditableTarget): Promise<{
  storageKey: string;
  record: EditableHistoryRecord;
  matchReason: 'stableKey' | 'descriptorKey' | 'label';
} | null> {
  const index = await storageGet<HistoryIndex | undefined>(HISTORY_INDEX_KEY) ?? {};
  const candidates = Object.entries(index)
    .filter(([storageKey, entry]) => {
      if (storageKey === target.storageKey) return false;
      if (entry.url !== target.url || entry.kind !== target.kind) return false;
      if (target.identity.stableKey && entry.stableKey === target.identity.stableKey) return true;
      if (entry.descriptorKey && entry.descriptorKey === target.identity.descriptorKey) return true;
      return entry.label === target.label;
    })
    .sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt));

  for (const [storageKey, entry] of candidates) {
    const record = await loadHistoryRecord(storageKey);
    if (!record) continue;

    if (target.identity.stableKey && record.identity?.stableKey === target.identity.stableKey) {
      return { storageKey, record, matchReason: 'stableKey' };
    }

    if (record.identity?.descriptorKey === target.identity.descriptorKey || record.descriptor === target.descriptor) {
      return { storageKey, record, matchReason: 'descriptorKey' };
    }

    if (entry.label === target.label && record.label === target.label) {
      return { storageKey, record, matchReason: 'label' };
    }
  }

  return null;
}

function normalizeRecordForTarget(
  record: EditableHistoryRecord,
  target: EditableTarget,
): EditableHistoryRecord {
  return {
    ...record,
    fieldKey: target.fieldKey,
    label: target.label,
    descriptor: target.descriptor,
    kind: target.kind,
    url: target.url,
    identity: target.identity,
  };
}

function recordNeedsNormalization(record: EditableHistoryRecord, target: EditableTarget): boolean {
  return (
    record.fieldKey !== target.fieldKey ||
    record.label !== target.label ||
    record.descriptor !== target.descriptor ||
    record.url !== target.url ||
    record.kind !== target.kind ||
    record.identity?.stableKey !== target.identity.stableKey ||
    record.identity?.descriptorKey !== target.identity.descriptorKey ||
    record.identity?.source !== target.identity.source
  );
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}
