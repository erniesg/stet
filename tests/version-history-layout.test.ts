import { describe, expect, it } from 'vitest';
import { computeFieldHistoryLayout } from '../packages/extension/src/content/version-history-layout.js';

function overlaps(
  target: { top: number; left: number; width: number; height: number },
  panel: { top: number; left: number; width: number; height: number },
) {
  return (
    Math.min(target.left + target.width, panel.left + panel.width) > Math.max(target.left, panel.left) &&
    Math.min(target.top + target.height, panel.top + panel.height) > Math.max(target.top, panel.top)
  );
}

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

  it('opens the panel outside the active target when there is room below it', () => {
    const targetRect = { top: 220, left: 300, width: 420, height: 160 };
    const panelHeight = 320;
    const layout = computeFieldHistoryLayout({
      targetRect,
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight,
      panelOpen: true,
    });

    expect(layout.visible).toBe(true);
    expect(layout.panel.placement).toBe('below');
    expect(layout.panel.top).toBeGreaterThanOrEqual(targetRect.top + targetRect.height);
    expect(overlaps(targetRect, {
      top: layout.panel.top,
      left: layout.panel.left,
      width: layout.panel.width,
      height: panelHeight,
    })).toBe(false);
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
    const targetRect = { top: 720, left: 520, width: 360, height: 120 };
    const panelHeight = 320;
    const layout = computeFieldHistoryLayout({
      targetRect,
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight,
      panelOpen: true,
    });

    expect(layout.visible).toBe(true);
    expect(layout.panel.placement).toBe('above');
    expect(layout.panel.top).toBeLessThan(layout.chip.top);
    expect(overlaps(targetRect, {
      top: layout.panel.top,
      left: layout.panel.left,
      width: layout.panel.width,
      height: panelHeight,
    })).toBe(false);
  });

  it('uses a side placement when the viewport cannot fit the panel above or below the target', () => {
    const targetRect = { top: 80, left: 220, width: 420, height: 740 };
    const panelHeight = 320;
    const layout = computeFieldHistoryLayout({
      targetRect,
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight,
      panelOpen: true,
    });

    expect(layout.visible).toBe(true);
    expect(layout.panel.placement).toBe('right');
    expect(overlaps(targetRect, {
      top: layout.panel.top,
      left: layout.panel.left,
      width: layout.panel.width,
      height: panelHeight,
    })).toBe(false);
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

  it('shifts the chip away from overlapping nearby controls when possible', () => {
    const targetRect = { top: 220, left: 300, width: 420, height: 160 };
    const layout = computeFieldHistoryLayout({
      targetRect,
      viewportWidth: 1280,
      viewportHeight: 900,
      chipWidth: 156,
      chipHeight: 42,
      panelWidth: 380,
      panelHeight: 420,
      panelOpen: false,
      obstacles: [
        { top: 170, left: 564, width: 140, height: 36 },
      ],
    });

    expect(layout.visible).toBe(true);
    expect(layout.chip.top).toBeLessThan(targetRect.top);
    expect(layout.chip.left + layout.chip.width).toBeLessThanOrEqual(564);
  });
});
