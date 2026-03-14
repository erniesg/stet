import { describe, expect, it } from 'vitest';

import { getHistoryRefreshTarget } from '../packages/extension/src/popup/popup-sync.js';

describe('popup sync helpers', () => {
  it('refreshes selected history only for updates from the active tab', () => {
    expect(getHistoryRefreshTarget(5, 5, { frameId: 0, fieldKey: 'body' })).toEqual({
      frameId: 0,
      fieldKey: 'body',
    });
    expect(getHistoryRefreshTarget(5, 6, { frameId: 0, fieldKey: 'body' })).toBeNull();
    expect(getHistoryRefreshTarget(null, 5, { frameId: 0, fieldKey: 'body' })).toBeNull();
    expect(getHistoryRefreshTarget(5, 5, null)).toBeNull();
  });
});
