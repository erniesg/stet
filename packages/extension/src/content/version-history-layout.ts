export interface HistoryLayoutRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FieldHistoryLayoutInput {
  targetRect: HistoryLayoutRect;
  viewportWidth: number;
  viewportHeight: number;
  chipWidth: number;
  chipHeight: number;
  panelWidth: number;
  panelHeight: number;
  panelOpen: boolean;
  padding?: number;
  gap?: number;
}

export interface FieldHistoryLayout {
  visible: boolean;
  chip: {
    top: number;
    left: number;
    width: number;
  };
  panel: {
    top: number;
    left: number;
    width: number;
    placement: 'above' | 'below';
  };
}

export function computeFieldHistoryLayout(input: FieldHistoryLayoutInput): FieldHistoryLayout {
  const padding = input.padding ?? 8;
  const gap = input.gap ?? 8;
  const viewportWidth = Math.max(0, input.viewportWidth);
  const viewportHeight = Math.max(0, input.viewportHeight);

  const chipWidth = clampSize(input.chipWidth, viewportWidth, padding, 140);
  const chipHeight = clampSize(input.chipHeight, viewportHeight, padding, 42);
  const panelWidth = clampSize(input.panelWidth, viewportWidth, padding, Math.max(chipWidth, 320));
  const panelHeight = clampSize(input.panelHeight, viewportHeight, padding, 360);

  const targetRight = input.targetRect.left + input.targetRect.width;
  const targetBottom = input.targetRect.top + input.targetRect.height;
  const visible = isTargetVisible(input.targetRect, viewportWidth, viewportHeight, padding);

  if (!visible) {
    return {
      visible: false,
      chip: { top: padding, left: padding, width: chipWidth },
      panel: { top: padding, left: padding, width: panelWidth, placement: 'below' },
    };
  }

  const chipLeft = clampPosition(targetRight - chipWidth, chipWidth, viewportWidth, padding);
  const chipTopAbove = input.targetRect.top - chipHeight - gap;
  const chipTopBelow = targetBottom + gap;
  const chipTop = chipTopAbove >= padding
    ? chipTopAbove
    : clampPosition(chipTopBelow, chipHeight, viewportHeight, padding);

  const panelLeft = clampPosition(
    Math.max(input.targetRect.left, targetRight - panelWidth),
    panelWidth,
    viewportWidth,
    padding,
  );

  const belowTop = chipTop + chipHeight + gap;
  const aboveTop = chipTop - panelHeight - gap;
  const fitsBelow = belowTop + panelHeight <= viewportHeight - padding;
  const fitsAbove = aboveTop >= padding;
  const placement = input.panelOpen && !fitsBelow && fitsAbove ? 'above' : 'below';
  const panelTop = placement === 'above'
    ? aboveTop
    : clampPosition(belowTop, panelHeight, viewportHeight, padding);

  return {
    visible: true,
    chip: {
      top: round(chipTop),
      left: round(chipLeft),
      width: round(chipWidth),
    },
    panel: {
      top: round(panelTop),
      left: round(panelLeft),
      width: round(panelWidth),
      placement,
    },
  };
}

function isTargetVisible(
  rect: HistoryLayoutRect,
  viewportWidth: number,
  viewportHeight: number,
  padding: number,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;

  return (
    right > padding &&
    bottom > padding &&
    rect.left < viewportWidth - padding &&
    rect.top < viewportHeight - padding
  );
}

function clampSize(size: number, viewportSize: number, padding: number, fallback: number): number {
  const maxSize = Math.max(0, viewportSize - padding * 2);
  if (maxSize === 0) return 0;
  const normalized = Number.isFinite(size) && size > 0 ? size : fallback;
  return Math.min(normalized, maxSize);
}

function clampPosition(value: number, size: number, viewportSize: number, padding: number): number {
  const max = Math.max(padding, viewportSize - size - padding);
  return Math.min(Math.max(value, padding), max);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
