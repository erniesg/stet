import type { EditableTarget } from './editable-target.js';
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
}

type HistoryIndex = Record<string, HistoryIndexEntry>;

const HISTORY_INDEX_KEY = 'stet:history:index';

export async function loadHistoryRecord(storageKey: string): Promise<EditableHistoryRecord | null> {
  const stored = await storageGet<EditableHistoryRecord | undefined>(storageKey);
  return stored ?? null;
}

export async function saveSnapshotForTarget(
  target: EditableTarget,
  text: string,
  source: SnapshotSource,
  policy: HistoryPolicy = DEFAULT_HISTORY_POLICY,
  force = false,
): Promise<EditableHistoryRecord | null> {
  const normalizedText = text.replace(/\r\n/g, '\n');
  if (normalizedText.length > policy.maxSnapshotChars) {
    console.warn(`[stet] Skipping history snapshot for ${target.label}: content exceeds ${policy.maxSnapshotChars} chars`);
    return loadHistoryRecord(target.storageKey);
  }

  const existing = await loadHistoryRecord(target.storageKey);
  const latest = existing?.snapshots.at(-1);

  if (!shouldSaveSnapshot(latest, normalizedText, policy, { force })) {
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
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    snapshots: pruneSnapshots([...(existing?.snapshots ?? []), snapshot], policy, now.getTime()),
  };

  await persistHistoryRecord(target.storageKey, record, policy);
  return record;
}

async function persistHistoryRecord(
  storageKey: string,
  record: EditableHistoryRecord,
  policy: HistoryPolicy,
): Promise<void> {
  const nextIndex = {
    ...(await storageGet<HistoryIndex | undefined>(HISTORY_INDEX_KEY) ?? {}),
    [storageKey]: {
      updatedAt: record.updatedAt,
      estimatedBytes: estimateRecordBytes(record),
      label: record.label,
      url: record.url,
    },
  };

  const pruned = pruneIndex(nextIndex, storageKey, policy);
  const keysToRemove = Object.keys(nextIndex).filter((key) => !(key in pruned));

  await storageSet({
    [storageKey]: record,
    [HISTORY_INDEX_KEY]: pruned,
  });

  if (keysToRemove.length > 0) {
    await storageRemove(keysToRemove);
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
