import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_POLICY,
  createSnapshot,
  pruneSnapshots,
  shouldSaveSnapshot,
  summarizeChange,
} from '../packages/extension/src/content/version-history-core.js';
import { diffLines, diffText } from '../packages/extension/src/content/version-history-diff.js';

describe('version history retention', () => {
  it('summarizes changed spans without full diffing', () => {
    const summary = summarizeChange('alpha beta gamma', 'alpha beta delta gamma');
    expect(summary.changedChars).toBeGreaterThan(0);
    expect(summary.changeRatio).toBeGreaterThan(0);
  });

  it('dedupes unchanged content even when save is forced', () => {
    const latest = createSnapshot('', 'hello world', 'autosave', DEFAULT_HISTORY_POLICY, new Date('2026-03-14T10:00:00.000Z'));

    expect(shouldSaveSnapshot(latest, 'hello world', DEFAULT_HISTORY_POLICY, {
      now: Date.parse('2026-03-14T10:00:02.000Z'),
    })).toBe(false);

    expect(shouldSaveSnapshot(latest, 'hello world', DEFAULT_HISTORY_POLICY, {
      now: Date.parse('2026-03-14T10:00:02.000Z'),
      force: true,
    })).toBe(false);
  });

  it('keeps recent versions dense and trims older noise', () => {
    const baseTime = Date.parse('2026-03-14T00:00:00.000Z');
    const baseParagraph = 'This is a long enough paragraph to avoid every tiny autosave becoming a milestone snapshot.';
    const snapshots = Array.from({ length: 28 }, (_, index) => createSnapshot(
      index === 0 ? '' : `${baseParagraph} Draft ${index - 1}.`,
      `${baseParagraph} Draft ${index}.`,
      index % 9 === 0 ? 'manual' : 'autosave',
      DEFAULT_HISTORY_POLICY,
      new Date(baseTime + index * 60 * 1000),
    ));

    const pruned = pruneSnapshots(snapshots, DEFAULT_HISTORY_POLICY, baseTime + 30 * 60 * 1000);

    expect(pruned.length).toBeLessThan(snapshots.length);
    expect(pruned.at(-1)?.content).toBe(`${baseParagraph} Draft 27.`);
    expect(pruned.some((snapshot) => snapshot.source === 'manual')).toBe(true);
  });
});

describe('version history diff preview', () => {
  it('returns insertions and deletions for current vs selected draft', () => {
    const diff = diffText('The quick brown fox', 'The quick red fox jumps');

    expect(diff.addedChars).toBeGreaterThan(0);
    expect(diff.removedChars).toBeGreaterThan(0);
    expect(diff.chunks.some((chunk) => chunk.type === 'insert')).toBe(true);
    expect(diff.chunks.some((chunk) => chunk.type === 'delete')).toBe(true);
  });

  it('returns git-style line rows for multi-line diffs', () => {
    const lines = diffLines(
      'alpha\nbeta\ngamma',
      'alpha\nbeta revised\ngamma\ndelta',
    );

    expect(lines).toEqual([
      { type: 'equal', value: 'alpha' },
      { type: 'delete', value: 'beta' },
      { type: 'insert', value: 'beta revised' },
      { type: 'equal', value: 'gamma' },
      { type: 'insert', value: 'delta' },
    ]);
  });
});
