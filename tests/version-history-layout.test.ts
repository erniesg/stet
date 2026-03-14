import { describe, expect, it } from 'vitest';
import { computeFieldHistoryLayout } from '../packages/extension/src/content/version-history-layout.js';

describe('field history layout', () => {
  it('anchors the chip above the target when there is room', () => {
    const layout = computeFieldHistoryLayout({
      targetRect: { top: 220, left: 300, width: 420, height: 160 },
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight: 420,
      panelOpen: false,
    });

    expect(layout.visible).toBe(true);
    expect(layout.chip.top).toBeLessThan(220);
    expect(layout.chip.left).toBeGreaterThanOrEqual(300);
  });

  it('drops the chip below the target when there is no room above', () => {
    const layout = computeFieldHistoryLayout({
      targetRect: { top: 12, left: 120, width: 520, height: 80 },
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight: 420,
      panelOpen: false,
    });

    expect(layout.visible).toBe(true);
    expect(layout.chip.top).toBeGreaterThan(12 + 80);
  });

  it('flips the panel above the chip when there is no room below', () => {
    const layout = computeFieldHistoryLayout({
      targetRect: { top: 720, left: 520, width: 360, height: 120 },
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight: 320,
      panelOpen: true,
    });

    expect(layout.visible).toBe(true);
    expect(layout.panel.placement).toBe('above');
    expect(layout.panel.top).toBeLessThan(layout.chip.top);
  });

  it('hides the field chip when the active target is offscreen', () => {
    const layout = computeFieldHistoryLayout({
      targetRect: { top: -260, left: 300, width: 420, height: 160 },
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight: 420,
      panelOpen: false,
    });

    expect(layout.visible).toBe(false);
  });
});
