export interface PopupHistoryRefreshTarget {
  frameId: number;
  fieldKey: string;
}

export function getHistoryRefreshTarget(
  activeTabId: number | null,
  messageTabId: number | undefined,
  selectedTarget: PopupHistoryRefreshTarget | null,
): PopupHistoryRefreshTarget | null {
  if (activeTabId === null || messageTabId !== activeTabId || !selectedTarget) {
    return null;
  }

  return selectedTarget;
}
