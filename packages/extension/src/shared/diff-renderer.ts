/**
 * Shared diff rendering — used by both the extension popup and the on-page
 * version-history panel.  Returns plain DOM (DocumentFragment) with inline
 * styles so it works without any external CSS dependency.
 */

import type { DiffChunk } from '../content/version-history-diff.js';

// ---------------------------------------------------------------------------
// Colours — single source of truth
// ---------------------------------------------------------------------------

const INS_BG   = 'rgba(34, 197, 94, 0.18)';
const INS_FG   = '#166534';
const DEL_BG   = 'rgba(239, 68, 68, 0.18)';
const DEL_FG   = '#991b1b';
const STAT_ADD = '#166534';
const STAT_REM = '#991b1b';
const BLOCK_ADD     = '#22c55e';
const BLOCK_REM     = '#ef4444';
const BLOCK_NEUTRAL = '#d1d5db';
const EMPTY_FG      = '#94a3b8';

// ---------------------------------------------------------------------------
// Inline diff
// ---------------------------------------------------------------------------

export function createInlineDiff(chunks: DiffChunk[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (chunks.length === 0) {
    const note = document.createElement('span');
    Object.assign(note.style, { fontSize: '12px', color: EMPTY_FG });
    note.textContent = 'No textual differences.';
    fragment.append(note);
    return fragment;
  }

  for (const chunk of chunks) {
    if (chunk.type === 'insert') {
      const ins = document.createElement('ins');
      Object.assign(ins.style, {
        background: INS_BG,
        color: INS_FG,
        textDecoration: 'none',
      });
      ins.textContent = chunk.value;
      fragment.append(ins);
    } else if (chunk.type === 'delete') {
      const del = document.createElement('del');
      Object.assign(del.style, {
        background: DEL_BG,
        color: DEL_FG,
        textDecoration: 'line-through',
      });
      del.textContent = chunk.value;
      fragment.append(del);
    } else {
      fragment.append(document.createTextNode(chunk.value));
    }
  }

  return fragment;
}

// ---------------------------------------------------------------------------
// Stat bar  (+N  -N  ■■■■■)
// ---------------------------------------------------------------------------

const STAT_BLOCKS = 5;

export function createDiffStat(added: number, removed: number): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const total = added + removed;
  const addBlocks = total > 0
    ? Math.max(added > 0 ? 1 : 0, Math.round((added / total) * STAT_BLOCKS))
    : 0;
  const removeBlocks = total > 0 ? STAT_BLOCKS - addBlocks : 0;

  const wrap = document.createElement('span');
  Object.assign(wrap.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    fontWeight: '600',
  });

  const addSpan = document.createElement('span');
  addSpan.style.color = STAT_ADD;
  addSpan.textContent = `+${added}`;

  const remSpan = document.createElement('span');
  remSpan.style.color = STAT_REM;
  remSpan.textContent = `-${removed}`;

  const bar = document.createElement('span');
  Object.assign(bar.style, { display: 'inline-flex', gap: '1px', fontSize: '10px' });

  for (let i = 0; i < addBlocks; i++) {
    const b = document.createElement('span');
    b.style.color = BLOCK_ADD;
    b.textContent = '■';
    bar.append(b);
  }
  for (let i = 0; i < removeBlocks; i++) {
    const b = document.createElement('span');
    b.style.color = BLOCK_REM;
    b.textContent = '■';
    bar.append(b);
  }
  if (total === 0) {
    for (let i = 0; i < STAT_BLOCKS; i++) {
      const b = document.createElement('span');
      b.style.color = BLOCK_NEUTRAL;
      b.textContent = '■';
      bar.append(b);
    }
  }

  wrap.append(addSpan, document.createTextNode(' '), remSpan, document.createTextNode(' '), bar);
  fragment.append(wrap);
  return fragment;
}
