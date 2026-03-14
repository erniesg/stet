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
  obstacles?: HistoryLayoutRect[];
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
    placement: 'above' | 'below' | 'left' | 'right';
  };
}

export function computeFieldHistoryLayout(input: FieldHistoryLayoutInput): FieldHistoryLayout {
  const padding = input.padding ?? 8;
  const gap = input.gap ?? 8;
  const obstacles = input.obstacles ?? [];
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

  const chipCandidates = buildChipCandidates({
    targetRect: input.targetRect,
    viewportWidth,
    viewportHeight,
    chipWidth,
    chipHeight,
    padding,
    gap,
    obstacles,
  });
  const chip = chipCandidates.find((candidate) => candidate.targetOverlapArea === 0 && candidate.obstacleOverlapArea === 0) ??
    [...chipCandidates].sort((leftCandidate, rightCandidate) => {
      if (leftCandidate.targetOverlapArea !== rightCandidate.targetOverlapArea) {
        return leftCandidate.targetOverlapArea - rightCandidate.targetOverlapArea;
      }
      if (leftCandidate.obstacleOverlapArea !== rightCandidate.obstacleOverlapArea) {
        return leftCandidate.obstacleOverlapArea - rightCandidate.obstacleOverlapArea;
      }
      return leftCandidate.preference - rightCandidate.preference;
    })[0];
  const chipAboveTarget = chip.top + chipHeight <= input.targetRect.top;

  const panelLeft = clampPosition(
    Math.max(input.targetRect.left, targetRight - panelWidth),
    panelWidth,
    viewportWidth,
    padding,
  );
  const orderedPlacements = chipAboveTarget
    ? ['below', 'above', 'right', 'left'] as const
    : ['above', 'below', 'right', 'left'] as const;
  const candidates = orderedPlacements.map((placement, preference) =>
    buildPanelCandidate({
      placement,
      targetRect: input.targetRect,
      viewportWidth,
      viewportHeight,
      panelWidth,
      panelHeight,
      padding,
      gap,
      obstacles,
      preferredLeft: panelLeft,
    }, preference),
  );
  const chosen = candidates.find((candidate) => candidate.targetOverlapArea === 0 && candidate.obstacleOverlapArea === 0) ??
    [...candidates].sort((leftCandidate, rightCandidate) => {
      if (leftCandidate.targetOverlapArea !== rightCandidate.targetOverlapArea) {
        return leftCandidate.targetOverlapArea - rightCandidate.targetOverlapArea;
      }
      if (leftCandidate.obstacleOverlapArea !== rightCandidate.obstacleOverlapArea) {
        return leftCandidate.obstacleOverlapArea - rightCandidate.obstacleOverlapArea;
      }
      return leftCandidate.preference - rightCandidate.preference;
    })[0];

  return {
    visible: true,
    chip: {
      top: round(chip.top),
      left: round(chip.left),
      width: round(chipWidth),
    },
    panel: {
      top: round(chosen.top),
      left: round(chosen.left),
      width: round(panelWidth),
      placement: chosen.placement,
    },
  };
}

interface PanelCandidateInput {
  placement: FieldHistoryLayout['panel']['placement'];
  targetRect: HistoryLayoutRect;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number;
  panelHeight: number;
  padding: number;
  gap: number;
  obstacles: HistoryLayoutRect[];
  preferredLeft: number;
}

interface PanelCandidate {
  placement: FieldHistoryLayout['panel']['placement'];
  top: number;
  left: number;
  targetOverlapArea: number;
  obstacleOverlapArea: number;
  preference: number;
}

interface ChipCandidate {
  top: number;
  left: number;
  targetOverlapArea: number;
  obstacleOverlapArea: number;
  preference: number;
}

function buildPanelCandidate(
  input: PanelCandidateInput,
  preference: number,
): PanelCandidate {
  const targetBottom = input.targetRect.top + input.targetRect.height;
  const targetRight = input.targetRect.left + input.targetRect.width;

  const top = input.placement === 'below'
    ? clampPosition(targetBottom + input.gap, input.panelHeight, input.viewportHeight, input.padding)
    : input.placement === 'above'
      ? clampPosition(
        input.targetRect.top - input.panelHeight - input.gap,
        input.panelHeight,
        input.viewportHeight,
        input.padding,
      )
      : clampPosition(input.targetRect.top, input.panelHeight, input.viewportHeight, input.padding);

  const left = input.placement === 'right'
    ? clampPosition(targetRight + input.gap, input.panelWidth, input.viewportWidth, input.padding)
    : input.placement === 'left'
      ? clampPosition(
        input.targetRect.left - input.panelWidth - input.gap,
        input.panelWidth,
        input.viewportWidth,
        input.padding,
      )
      : input.preferredLeft;

  return {
    placement: input.placement,
    top,
    left,
    targetOverlapArea: computeOverlapArea(
      input.targetRect,
      {
        top,
        left,
        width: input.panelWidth,
        height: input.panelHeight,
      },
    ),
    obstacleOverlapArea: computeTotalOverlapArea(
      {
        top,
        left,
        width: input.panelWidth,
        height: input.panelHeight,
      },
      input.obstacles,
    ),
    preference,
  };
}

interface ChipCandidateInput {
  targetRect: HistoryLayoutRect;
  viewportWidth: number;
  viewportHeight: number;
  chipWidth: number;
  chipHeight: number;
  padding: number;
  gap: number;
  obstacles: HistoryLayoutRect[];
}

function buildChipCandidates(input: ChipCandidateInput): ChipCandidate[] {
  const targetRight = input.targetRect.left + input.targetRect.width;
  const targetBottom = input.targetRect.top + input.targetRect.height;
  const verticalCandidates = [
    {
      top: clampPosition(input.targetRect.top - input.chipHeight - input.gap, input.chipHeight, input.viewportHeight, input.padding),
      preference: 0,
    },
    {
      top: clampPosition(targetBottom + input.gap, input.chipHeight, input.viewportHeight, input.padding),
      preference: 1,
    },
  ];
  const horizontalCandidates = [
    {
      left: clampPosition(targetRight - input.chipWidth, input.chipWidth, input.viewportWidth, input.padding),
      preference: 0,
    },
    {
      left: clampPosition(
        input.targetRect.left + (input.targetRect.width - input.chipWidth) / 2,
        input.chipWidth,
        input.viewportWidth,
        input.padding,
      ),
      preference: 1,
    },
    {
      left: clampPosition(input.targetRect.left, input.chipWidth, input.viewportWidth, input.padding),
      preference: 2,
    },
  ];

  return verticalCandidates.flatMap((verticalCandidate) => {
    return horizontalCandidates.map((horizontalCandidate) => {
      const rect = {
        top: verticalCandidate.top,
        left: horizontalCandidate.left,
        width: input.chipWidth,
        height: input.chipHeight,
      };

      return {
        top: verticalCandidate.top,
        left: horizontalCandidate.left,
        targetOverlapArea: computeOverlapArea(input.targetRect, rect),
        obstacleOverlapArea: computeTotalOverlapArea(rect, input.obstacles),
        preference: verticalCandidate.preference * horizontalCandidates.length + horizontalCandidate.preference,
      };
    });
  });
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

function computeOverlapArea(leftRect: HistoryLayoutRect, rightRect: HistoryLayoutRect): number {
  const overlapWidth = Math.min(
    leftRect.left + leftRect.width,
    rightRect.left + rightRect.width,
  ) - Math.max(leftRect.left, rightRect.left);
  const overlapHeight = Math.min(
    leftRect.top + leftRect.height,
    rightRect.top + rightRect.height,
  ) - Math.max(leftRect.top, rightRect.top);

  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
  return overlapWidth * overlapHeight;
}

function computeTotalOverlapArea(rect: HistoryLayoutRect, obstacles: HistoryLayoutRect[]): number {
  let total = 0;

  for (const obstacle of obstacles) {
    total += computeOverlapArea(rect, obstacle);
  }

  return total;
}
