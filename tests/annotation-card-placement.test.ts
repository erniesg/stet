// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { computeCardPosition } from '../packages/extension/src/content/annotation-manager.js';

describe('computeCardPosition', () => {
  const viewport = {
    width: 900,
    height: 700,
    scrollX: 0,
    scrollY: 0,
  };

  it('clamps the card inside the left viewport edge', () => {
    const position = computeCardPosition(
      {
        left: 2,
        top: 40,
        right: 42,
        bottom: 56,
      },
      { width: 320, height: 180 },
      viewport,
    );

    expect(position.left).toBe(8);
    expect(position.top).toBe(62);
    expect(position.placement).toBe('below');
  });

  it('shifts the card left when it would overflow the right edge', () => {
    const position = computeCardPosition(
      {
        left: 840,
        top: 40,
        right: 860,
        bottom: 56,
      },
      { width: 320, height: 180 },
      viewport,
    );

    expect(position.left).toBe(572);
    expect(position.top).toBe(62);
    expect(position.placement).toBe('below');
  });

  it('places the card above the mark when there is not enough room below', () => {
    const position = computeCardPosition(
      {
        left: 180,
        top: 660,
        right: 220,
        bottom: 676,
      },
      { width: 320, height: 180 },
      viewport,
    );

    expect(position.left).toBe(180);
    expect(position.top).toBe(474);
    expect(position.placement).toBe('above');
  });

  it('clamps vertically when the card is taller than the available space on both sides', () => {
    const position = computeCardPosition(
      {
        left: 180,
        top: 240,
        right: 220,
        bottom: 256,
      },
      { width: 320, height: 760 },
      viewport,
    );

    expect(position.left).toBe(180);
    expect(position.top).toBe(8);
    expect(position.placement).toBe('below');
  });
});
