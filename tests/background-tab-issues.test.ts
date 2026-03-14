import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RuntimeListener {
  (
    message: Record<string, unknown>,
    sender: { tab?: { id?: number }; frameId?: number },
    sendResponse: (response: unknown) => void,
  ): boolean | void;
}

interface StorageBacking {
  sync: Record<string, unknown>;
  local: Record<string, unknown>;
  session: Record<string, unknown>;
}

function createStorageArea(backing: Record<string, unknown>) {
  return {
    get: vi.fn((keys: unknown, callback: (result: Record<string, unknown>) => void) => {
      if (typeof keys === 'string') {
        callback({ [keys]: backing[keys] });
        return;
      }

      if (Array.isArray(keys)) {
        callback(keys.reduce<Record<string, unknown>>((result, key) => {
          result[key] = backing[key];
          return result;
        }, {}));
        return;
      }

      if (typeof keys === 'object' && keys !== null) {
        const defaults = keys as Record<string, unknown>;
        callback({ ...defaults, ...backing });
        return;
      }

      callback({ ...backing });
    }),
    set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
      Object.assign(backing, items);
      callback?.();
    }),
    remove: vi.fn((keys: string | string[], callback?: () => void) => {
      const toDelete = Array.isArray(keys) ? keys : [keys];
      for (const key of toDelete) {
        delete backing[key];
      }
      callback?.();
    }),
  };
}

function setupChromeMock(backing: StorageBacking) {
  const runtimeListeners: RuntimeListener[] = [];
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    onInstalled: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn((listener: RuntimeListener) => {
        runtimeListeners.push(listener);
      }),
    },
    sendMessage: vi.fn(),
  };

  const tabs = {
    onRemoved: {
      addListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  };

  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    runtime,
    tabs,
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    storage: {
      sync: createStorageArea(backing.sync),
      local: createStorageArea(backing.local),
      session: createStorageArea(backing.session),
    },
  };

  return { runtimeListeners, runtime, tabs };
}

async function dispatchRuntimeMessage(
  listener: RuntimeListener,
  message: Record<string, unknown>,
  sender: { tab?: { id?: number }; frameId?: number } = {},
) {
  return new Promise<unknown>((resolve) => {
    let responded = false;
    const sendResponse = (response: unknown) => {
      responded = true;
      resolve(response);
    };

    const handledAsync = listener(message, sender, sendResponse);
    if (handledAsync === false && !responded) {
      resolve(undefined);
    }
  });
}

function createIssueState(overrides: Partial<{
  totalIssues: number;
  editorCount: number;
  activeFieldKey: string | null;
  activeLabel: string | null;
  issues: Array<Record<string, unknown>>;
}> = {}) {
  return {
    enabled: true,
    totalIssues: overrides.totalIssues ?? 1,
    editorCount: overrides.editorCount ?? 1,
    activeFieldKey: overrides.activeFieldKey ?? 'field-1',
    activeLabel: overrides.activeLabel ?? 'Body',
    issues: overrides.issues ?? [
      {
        key: 'issue-1',
        rule: 'SPELL',
        severity: 'warning',
        originalText: 'teh',
        suggestion: 'the',
        description: 'Spelling issue',
        canFix: true,
      },
    ],
  };
}

describe('background tab issue sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('loads persisted tab issue state after a worker restart', async () => {
    const backing: StorageBacking = { sync: {}, local: {}, session: {} };
    const firstChrome = setupChromeMock(backing);
    await import('../packages/extension/src/background/service-worker.js');

    const firstListener = firstChrome.runtimeListeners.at(-1);
    expect(firstListener).toBeTruthy();

    await dispatchRuntimeMessage(
      firstListener!,
      { type: 'SYNC_PAGE_ISSUES', state: createIssueState({ totalIssues: 2 }) },
      { tab: { id: 17 }, frameId: 3 },
    );

    vi.resetModules();

    const secondChrome = setupChromeMock(backing);
    await import('../packages/extension/src/background/service-worker.js');
    const secondListener = secondChrome.runtimeListeners.at(-1);
    expect(secondListener).toBeTruthy();

    const state = await dispatchRuntimeMessage(secondListener!, {
      type: 'GET_TAB_ISSUES',
      tabId: 17,
    }) as {
      totalIssues: number;
      editorCount: number;
      activeFrameId: number | null;
      activeFieldKey: string | null;
      activeLabel: string | null;
      issues: Array<{ rule: string }>;
    };

    expect(state.totalIssues).toBe(2);
    expect(state.editorCount).toBe(1);
    expect(state.activeFrameId).toBe(3);
    expect(state.activeFieldKey).toBe('field-1');
    expect(state.activeLabel).toBe('Body');
    expect(state.issues[0]?.rule).toBe('SPELL');
  });

  it('refreshes the persisted active frame so popup state follows on-page fixes', async () => {
    const backing: StorageBacking = { sync: {}, local: {}, session: {} };
    const chromeMock = setupChromeMock(backing);
    await import('../packages/extension/src/background/service-worker.js');

    const listener = chromeMock.runtimeListeners.at(-1);
    expect(listener).toBeTruthy();

    await dispatchRuntimeMessage(
      listener!,
      { type: 'SYNC_PAGE_ISSUES', state: createIssueState({ totalIssues: 1 }) },
      { tab: { id: 22 }, frameId: 4 },
    );

    chromeMock.tabs.sendMessage.mockImplementation((
      _tabId: number,
      _message: Record<string, unknown>,
      options: { frameId?: number },
      callback: (response?: unknown) => void,
    ) => {
      if (options.frameId === 4) {
        callback(createIssueState({
          totalIssues: 0,
          issues: [],
        }));
        return;
      }

      chromeMock.runtime.lastError = { message: 'Receiving end does not exist.' };
      callback(undefined);
      chromeMock.runtime.lastError = undefined;
    });

    const refreshed = await dispatchRuntimeMessage(listener!, {
      type: 'REFRESH_TAB_ISSUES',
      tabId: 22,
    }) as {
      totalIssues: number;
      activeFrameId: number | null;
      activeFieldKey: string | null;
      issues: Array<unknown>;
    };

    expect(refreshed.totalIssues).toBe(0);
    expect(refreshed.activeFrameId).toBe(4);
    expect(refreshed.activeFieldKey).toBe('field-1');
    expect(refreshed.issues).toHaveLength(0);

    const cached = await dispatchRuntimeMessage(listener!, {
      type: 'GET_TAB_ISSUES',
      tabId: 22,
    }) as {
      totalIssues: number;
      issues: Array<unknown>;
    };

    expect(cached.totalIssues).toBe(0);
    expect(cached.issues).toHaveLength(0);
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      22,
      { type: 'GET_PAGE_ISSUES' },
      { frameId: 4 },
      expect.any(Function),
    );
  });
});
