export type SnapshotSource = 'autosave' | 'manual' | 'restore' | 'blur';

export interface EditableHistoryIdentitySignals {
  label: string | null;
  id: string | null;
  name: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  dataTestId: string | null;
  role: string | null;
  containerHint: string | null;
}

export interface EditableHistoryIdentity {
  descriptorKey: string;
  stableKey: string | null;
  source: 'stable' | 'descriptor';
  signals: EditableHistoryIdentitySignals;
}

export interface VersionSnapshot {
  id: string;
  savedAt: string;
  content: string;
  charCount: number;
  changedChars: number;
  changeRatio: number;
  isMilestone: boolean;
  source: SnapshotSource;
}

export interface EditableHistoryRecord {
  fieldKey: string;
  label: string;
  descriptor: string;
  kind: 'textarea' | 'contenteditable';
  url: string;
  identity?: EditableHistoryIdentity;
  createdAt: string;
  updatedAt: string;
  snapshots: VersionSnapshot[];
}

export interface HistoryPolicy {
  debounceMs: number;
  minSaveIntervalMs: number;
  forceSaveIntervalMs: number;
  keepLatest: number;
  maxVersions: number;
  maxTrackedFields: number;
  maxTotalBytes: number;
  maxSnapshotChars: number;
  minorChangeRatio: number;
  majorChangeRatio: number;
  majorChangeChars: number;
  recentWindowMs: number;
  mediumWindowMs: number;
  recentMinGapMs: number;
  mediumMinGapMs: number;
  staleMinGapMs: number;
}

export interface ChangeSummary {
  changedChars: number;
  changeRatio: number;
}

export interface RestoreVerification {
  ok: boolean;
  changedChars: number;
  changeRatio: number;
  expectedLength: number;
  actualLength: number;
}

export interface ShouldSaveSnapshotOptions {
  force?: boolean;
  now?: number;
}

export const DEFAULT_HISTORY_POLICY: HistoryPolicy = {
  debounceMs: 2500,
  minSaveIntervalMs: 5000,
  forceSaveIntervalMs: 30000,
  keepLatest: 15,
  maxVersions: 80,
  maxTrackedFields: 120,
  maxTotalBytes: 4_500_000,
  maxSnapshotChars: 200_000,
  minorChangeRatio: 0.04,
  majorChangeRatio: 0.18,
  majorChangeChars: 160,
  recentWindowMs: 2 * 60 * 60 * 1000,
  mediumWindowMs: 24 * 60 * 60 * 1000,
  recentMinGapMs: 2 * 60 * 1000,
  mediumMinGapMs: 15 * 60 * 1000,
  staleMinGapMs: 2 * 60 * 60 * 1000,
};

export function summarizeChange(previousText: string, nextText: string): ChangeSummary {
  if (previousText === nextText) {
    return { changedChars: 0, changeRatio: 0 };
  }

  const prefixLength = getCommonPrefixLength(previousText, nextText);
  const suffixLength = getCommonSuffixLength(previousText, nextText, prefixLength);

  const previousChanged = Math.max(0, previousText.length - prefixLength - suffixLength);
  const nextChanged = Math.max(0, nextText.length - prefixLength - suffixLength);
  const changedChars = previousChanged + nextChanged;
  const baseline = Math.max(previousText.length, nextText.length, 1);

  return {
    changedChars,
    changeRatio: changedChars / baseline,
  };
}

export function shouldSaveSnapshot(
  latestSnapshot: VersionSnapshot | undefined,
  nextText: string,
  policy: HistoryPolicy = DEFAULT_HISTORY_POLICY,
  options: ShouldSaveSnapshotOptions = {},
): boolean {
  const now = options.now ?? Date.now();
  const normalizedText = normalizeText(nextText);

  if (!latestSnapshot) return normalizedText.length > 0;
  if (latestSnapshot.content === normalizedText) return false;
  if (options.force) return true;

  const lastSavedAt = Date.parse(latestSnapshot.savedAt);
  const elapsed = Number.isFinite(lastSavedAt) ? now - lastSavedAt : policy.minSaveIntervalMs;
  const summary = summarizeChange(latestSnapshot.content, normalizedText);

  if (elapsed >= policy.forceSaveIntervalMs) return true;
  if (elapsed < policy.minSaveIntervalMs) {
    return summary.changeRatio >= policy.minorChangeRatio || summary.changedChars >= 24;
  }

  return summary.changedChars > 0;
}

export function createSnapshot(
  previousText: string,
  nextText: string,
  source: SnapshotSource,
  policy: HistoryPolicy = DEFAULT_HISTORY_POLICY,
  now = new Date(),
): VersionSnapshot {
  const normalizedText = normalizeText(nextText);
  const summary = summarizeChange(previousText, normalizedText);

  return {
    id: `version-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now.toISOString(),
    content: normalizedText,
    charCount: normalizedText.length,
    changedChars: summary.changedChars,
    changeRatio: summary.changeRatio,
    isMilestone: isMilestoneSnapshot(summary, normalizedText, source, policy),
    source,
  };
}

export function pruneSnapshots(
  snapshots: VersionSnapshot[],
  policy: HistoryPolicy = DEFAULT_HISTORY_POLICY,
  now = Date.now(),
): VersionSnapshot[] {
  if (snapshots.length <= policy.keepLatest) {
    return snapshots.slice(-policy.maxVersions);
  }

  const latest = snapshots.slice(-policy.keepLatest);
  const keepIds = new Set(latest.map((snapshot) => snapshot.id));
  let newestKeptTimestamp = Date.parse(latest[0].savedAt);

  for (let index = snapshots.length - policy.keepLatest - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    const savedAt = Date.parse(snapshot.savedAt);
    if (!Number.isFinite(savedAt)) continue;

    const age = now - savedAt;
    const gap = snapshot.isMilestone
      ? getMilestoneGapMs(age, policy)
      : getRetentionGapMs(age, policy);

    if (!Number.isFinite(newestKeptTimestamp) || newestKeptTimestamp - savedAt >= gap) {
      keepIds.add(snapshot.id);
      newestKeptTimestamp = savedAt;
    }
  }

  const selected = snapshots.filter((snapshot) => keepIds.has(snapshot.id));
  if (selected.length <= policy.maxVersions) return selected;

  const protectedIds = new Set(latest.map((snapshot) => snapshot.id));
  const removable = [...selected]
    .filter((snapshot) => !protectedIds.has(snapshot.id))
    .sort((left, right) => Date.parse(left.savedAt) - Date.parse(right.savedAt));

  const excess = selected.length - policy.maxVersions;
  const removedIds = new Set<string>();
  let removed = 0;

  for (const snapshot of removable) {
    if (removed >= excess) break;
    if (snapshot.isMilestone) continue;
    removedIds.add(snapshot.id);
    removed += 1;
  }

  for (const snapshot of removable) {
    if (removed >= excess) break;
    if (removedIds.has(snapshot.id)) continue;
    removedIds.add(snapshot.id);
    removed += 1;
  }

  return selected.filter((snapshot) => !removedIds.has(snapshot.id));
}

export function estimateRecordBytes(record: EditableHistoryRecord): number {
  return JSON.stringify(record).length * 2;
}

export function verifyRestoredContent(expectedText: string, actualText: string): RestoreVerification {
  const normalizedExpected = normalizeText(expectedText);
  const normalizedActual = normalizeText(actualText);
  const summary = summarizeChange(normalizedExpected, normalizedActual);

  return {
    ok: normalizedExpected === normalizedActual,
    changedChars: summary.changedChars,
    changeRatio: summary.changeRatio,
    expectedLength: normalizedExpected.length,
    actualLength: normalizedActual.length,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function isMilestoneSnapshot(
  summary: ChangeSummary,
  text: string,
  source: SnapshotSource,
  policy: HistoryPolicy,
): boolean {
  if (source === 'manual' || source === 'restore') return true;
  if (text.length === 0) return true;
  return summary.changeRatio >= policy.majorChangeRatio || summary.changedChars >= policy.majorChangeChars;
}

function getRetentionGapMs(age: number, policy: HistoryPolicy): number {
  if (age <= policy.recentWindowMs) return policy.recentMinGapMs;
  if (age <= policy.mediumWindowMs) return policy.mediumMinGapMs;
  return policy.staleMinGapMs;
}

function getMilestoneGapMs(age: number, policy: HistoryPolicy): number {
  return Math.max(60 * 1000, Math.floor(getRetentionGapMs(age, policy) / 3));
}

function getCommonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;

  while (index < max && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function getCommonSuffixLength(left: string, right: string, prefixLength: number): number {
  const leftLength = left.length;
  const rightLength = right.length;
  const max = Math.min(leftLength, rightLength) - prefixLength;
  let index = 0;

  while (
    index < max &&
    left[leftLength - 1 - index] === right[rightLength - 1 - index]
  ) {
    index += 1;
  }

  return index;
}
