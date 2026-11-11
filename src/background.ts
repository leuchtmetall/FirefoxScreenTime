import {
  forgetPresentation,
  initializePresentation,
  presentTab,
} from "./background/presentation.ts";
import {
  DEFAULT_SETTINGS,
  MS_PER_MINUTE,
  STORAGE_BLOCK_ALL_KEY,
  STORAGE_BLOCK_TRACKED_KEY,
  STORAGE_SETTINGS_KEY,
  STORAGE_USAGE_KEY,
  TAB_EXCLUDED_KEY,
  TAB_INHERITED_KEY,
} from "./shared/constants.ts";
import {
  addActiveInterval,
  effectiveLimitMs,
  freshDailyUsage,
  isDailyBlocked,
  rollUsageToNow,
} from "./shared/daily.ts";
import { validateSettings } from "./shared/settings.ts";
import { setTabExcluded, transitionTabState } from "./shared/tracking.ts";
import type {
  DailyUsage,
  ExtendDuration,
  ExtensionRequest,
  ExtensionResponse,
  Settings,
  StatusSnapshot,
  TabTrackingState,
} from "./shared/types.ts";

const CHECKPOINT_ALARM = "screen-time-checkpoint";
/** Keyed by request type so the compiler rejects this map when a request type is added or removed. */
const REQUEST_TYPES: Record<ExtensionRequest["type"], true> = {
  "get-status": true,
  "save-settings": true,
  extend: true,
  "set-tab-excluded": true,
  "set-block-all": true,
  "set-block-tracked": true,
  "reset-today": true,
};
const tabStates = new Map<number, TabTrackingState>();

/** The parts of a status snapshot that are the same for every tab. */
type SharedStatus = Omit<StatusSnapshot, "currentTabTracked" | "currentTabExcluded">;

let settings: Settings = DEFAULT_SETTINGS;
let usage: DailyUsage = freshDailyUsage(Date.now());
/** Block-everything mode: all tabs are covered and the daily timer is paused. Persists until toggled off. */
let blockAll = false;
/** Block-tracked mode: tracked tabs are covered regardless of remaining time. Persists until toggled off. */
let blockTracked = false;
let focusedWindowId = browser.windows.WINDOW_ID_NONE;
let activeTabId: number | undefined;
let activeStartedAt: number | undefined;
let lastAccountingAt = Date.now();
let queue: Promise<unknown> = Promise.resolve();

const ignore = (): undefined => undefined;

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    (error: unknown) => console.error("Screen Time operation failed", error),
  );
  return result;
}

/** Runs an event handler in order with all other state changes, once initialization has finished. */
function queueTask(task: () => Promise<void>): void {
  void enqueue(async () => {
    await ready;
    await task();
  });
}

async function initialize(): Promise<void> {
  const now = Date.now();
  const stored = await browser.storage.local.get([
    STORAGE_SETTINGS_KEY,
    STORAGE_USAGE_KEY,
    STORAGE_BLOCK_ALL_KEY,
    STORAGE_BLOCK_TRACKED_KEY,
  ]);
  blockAll = stored[STORAGE_BLOCK_ALL_KEY] === true;
  blockTracked = stored[STORAGE_BLOCK_TRACKED_KEY] === true;
  const storedUsage = stored[STORAGE_USAGE_KEY] as DailyUsage | undefined;

  if (stored[STORAGE_SETTINGS_KEY] !== undefined)
    settings = validateSettings(stored[STORAGE_SETTINGS_KEY]);
  usage = rollUsageToNow(storedUsage ?? freshDailyUsage(now), now);
  // The day changed while the browser was closed.
  if (storedUsage && storedUsage.dayKey !== usage.dayKey && settings.startDayPaused)
    blockTracked = true;

  const [tabs, lastFocused] = await Promise.all([
    browser.tabs.query({}),
    browser.windows.getLastFocused(),
  ]);
  focusedWindowId = lastFocused.focused
    ? (lastFocused.id ?? browser.windows.WINDOW_ID_NONE)
    : browser.windows.WINDOW_ID_NONE;

  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      const [inherited, excluded] = await Promise.all([
        browser.sessions.getTabValue(tab.id, TAB_INHERITED_KEY).catch(() => false),
        browser.sessions.getTabValue(tab.id, TAB_EXCLUDED_KEY).catch(() => false),
      ]);
      tabStates.set(
        tab.id,
        transitionTabState(
          { inherited: inherited === true, excluded: excluded === true, tracked: false },
          tab.url,
          settings.trackedHostnames,
          false,
        ),
      );
      if (tab.active && tab.windowId === focusedWindowId) activeTabId = tab.id;
    }),
  );

  await browser.storage.local.set({
    [STORAGE_SETTINGS_KEY]: settings,
    [STORAGE_USAGE_KEY]: usage,
    [STORAGE_BLOCK_TRACKED_KEY]: blockTracked,
  });
  await initializePresentation();
  beginActiveSession(now);
  await refreshAllTabs();
}

const ready = initialize();

function canAccumulate(): boolean {
  if (blockAll || blockTracked) return false;
  if (activeTabId === undefined || focusedWindowId === browser.windows.WINDOW_ID_NONE) return false;
  return (
    tabStates.get(activeTabId)?.tracked === true &&
    !isDailyBlocked(usage, settings.dailyLimitMinutes)
  );
}

function beginActiveSession(now: number): void {
  activeStartedAt = canAccumulate() ? now : undefined;
}

/** Usage including the active interval that has not been settled yet. */
function accruedUsage(now: number): DailyUsage {
  if (activeStartedAt === undefined) return rollUsageToNow(usage, now);
  // Rolls over to a new day itself, counting only the part of the interval that falls in it.
  const accrued = addActiveInterval(usage, activeStartedAt, now);
  if (accrued.blockingDisabled) return accrued;
  return {
    ...accrued,
    elapsedMs: Math.min(accrued.elapsedMs, effectiveLimitMs(accrued, settings.dailyLimitMinutes)),
  };
}

async function saveUsage(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_USAGE_KEY]: usage });
}

/** Folds the active interval into `usage` and stops accumulating; only writes storage if usage changed. */
async function settle(eventTime: number): Promise<number> {
  const now = Math.max(eventTime, lastAccountingAt);
  lastAccountingAt = now;
  const previous = usage;
  usage = accruedUsage(now);
  activeStartedAt = undefined;
  if (usage !== previous) {
    // A new day began: pause before saving the rolled usage, so an interrupted write is retried on startup.
    if (usage.dayKey !== previous.dayKey && settings.startDayPaused && !blockTracked)
      await setBlockTracked(true);
    await saveUsage();
  }
  return now;
}

/** Settles usage up to the event, applies a state change, then resumes accounting under the new state. */
async function accounted(eventTime: number, apply: () => Promise<void> | void): Promise<void> {
  const now = await settle(eventTime);
  try {
    await apply();
  } finally {
    beginActiveSession(now);
  }
}

function sharedStatus(): SharedStatus {
  const current = accruedUsage(Math.max(Date.now(), lastAccountingAt));
  return {
    settings,
    usage: current,
    effectiveLimitMs: effectiveLimitMs(current, settings.dailyLimitMinutes),
    blocked: isDailyBlocked(current, settings.dailyLimitMinutes),
    blockAll,
    blockTracked,
  };
}

function snapshot(tabId = activeTabId, shared = sharedStatus()): StatusSnapshot {
  const state = tabId === undefined ? undefined : tabStates.get(tabId);
  return {
    ...shared,
    currentTabTracked: state?.tracked === true,
    currentTabExcluded: state?.excluded === true,
  };
}

async function refreshTab(tabId: number, shared = sharedStatus()): Promise<void> {
  await presentTab(tabId, tabStates.get(tabId), snapshot(tabId, shared));
}

/** Reapplies everything a tab displays, e.g. after Firefox reset its toolbar values or it loaded a new document. */
async function representTab(tabId: number): Promise<void> {
  forgetPresentation(tabId);
  await refreshTab(tabId);
}

async function refreshAllTabs(): Promise<void> {
  const shared = sharedStatus();
  await Promise.all([...tabStates.keys()].map((tabId) => refreshTab(tabId, shared)));
}

/** Stores a per-tab flag with the tab's session, so it survives restarts and tab restores. */
async function persistTabFlag(tabId: number, key: string, value: boolean): Promise<void> {
  await browser.sessions.setTabValue(tabId, key, value).catch(ignore);
}

async function checkpoint(): Promise<void> {
  const previous = usage;
  await accounted(Date.now(), ignore);
  // With no active tracked tab and no day rollover, nothing visible can have changed.
  if (usage !== previous) await refreshAllTabs();
}

async function setTabState(
  tabId: number,
  url: string | undefined,
  typedNavigation: boolean,
): Promise<void> {
  const previous = tabStates.get(tabId);
  const next = transitionTabState(previous, url, settings.trackedHostnames, typedNavigation);
  tabStates.set(tabId, next);
  if (previous?.inherited !== next.inherited) {
    await persistTabFlag(tabId, TAB_INHERITED_KEY, next.inherited);
  }
}

async function selectActiveTab(windowId: number): Promise<void> {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    activeTabId = undefined;
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, windowId });
  activeTabId = tab?.id;
}

async function saveSettings(candidate: unknown): Promise<void> {
  settings = validateSettings(candidate);
  await browser.storage.local.set({ [STORAGE_SETTINGS_KEY]: settings });
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : setTabState(tab.id, tab.url, false))),
  );
}

async function setBlockAll(enabled: boolean): Promise<void> {
  blockAll = enabled;
  await browser.storage.local.set({ [STORAGE_BLOCK_ALL_KEY]: blockAll });
}

async function setBlockTracked(enabled: boolean): Promise<void> {
  blockTracked = enabled;
  await browser.storage.local.set({ [STORAGE_BLOCK_TRACKED_KEY]: blockTracked });
}

async function setTabExclusion(tabId: number, excluded: boolean): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  tabStates.set(
    tabId,
    setTabExcluded(tabStates.get(tabId), tab.url, settings.trackedHostnames, excluded),
  );
  await persistTabFlag(tabId, TAB_EXCLUDED_KEY, excluded);
}

async function extend(durationMinutes: ExtendDuration): Promise<void> {
  if (blockAll) throw new Error("Turn off block-everything mode first.");
  if (blockTracked) throw new Error("Turn off block-tracked mode first.");
  if (durationMinutes === "rest-of-day") {
    usage = { ...usage, blockingDisabled: true };
  } else if (durationMinutes === 5 || durationMinutes === 15) {
    usage = { ...usage, extraMs: usage.extraMs + durationMinutes * MS_PER_MINUTE };
  } else {
    throw new Error("Invalid extension duration.");
  }
  await saveUsage();
}

/** Starts today over: clears used time and any extensions granted today. */
async function resetToday(): Promise<void> {
  usage = freshDailyUsage(Date.now());
  await saveUsage();
}

/** Requests cross a messaging boundary, so their fields are checked at runtime despite their static types. */
function requireType<T>(value: unknown, type: "boolean" | "number", message: string): T {
  if (typeof value !== type) throw new Error(message);
  return value as T;
}

async function applyRequest(
  request: Exclude<ExtensionRequest, { type: "get-status" }>,
): Promise<void> {
  switch (request.type) {
    case "save-settings":
      return saveSettings(request.settings);
    case "set-block-all":
      return setBlockAll(
        requireType<boolean>(request.enabled, "boolean", "Invalid block-everything request."),
      );
    case "set-block-tracked":
      return setBlockTracked(
        requireType<boolean>(request.enabled, "boolean", "Invalid block-tracked request."),
      );
    case "set-tab-excluded":
      return setTabExclusion(
        requireType<number>(request.tabId, "number", "Invalid tab request."),
        requireType<boolean>(request.excluded, "boolean", "Invalid tab request."),
      );
    case "extend":
      return extend(request.durationMinutes);
    case "reset-today":
      return resetToday();
  }
}

function isExtensionRequest(message: unknown): message is ExtensionRequest {
  if (typeof message !== "object" || message === null) return false;
  const { type } = message as { type?: unknown };
  return typeof type === "string" && Object.hasOwn(REQUEST_TYPES, type);
}

browser.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: 0.25 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECKPOINT_ALARM) queueTask(checkpoint);
});

browser.tabs.onCreated.addListener((tab) => {
  queueTask(async () => {
    if (tab.id === undefined) return;
    const openerTracked =
      tab.openerTabId !== undefined && tabStates.get(tab.openerTabId)?.tracked === true;
    const state = transitionTabState(
      { inherited: openerTracked, excluded: false, tracked: openerTracked },
      tab.url,
      settings.trackedHostnames,
      false,
    );
    tabStates.set(tab.id, state);
    if (state.inherited) await persistTabFlag(tab.id, TAB_INHERITED_KEY, true);
    await refreshTab(tab.id);
  });
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const typedNavigation =
    details.transitionType === "typed" || details.transitionQualifiers.includes("from_address_bar");
  queueTask(async () => {
    await accounted(details.timeStamp, () =>
      setTabState(details.tabId, details.url, typedNavigation),
    );
    // Firefox resets per-tab toolbar values on navigation, and the new document has no overlay yet.
    await representTab(details.tabId);
  });
});

browser.tabs.onActivated.addListener((activeInfo) => {
  const eventTime = Date.now();
  queueTask(async () => {
    await accounted(eventTime, () => {
      activeTabId = focusedWindowId === activeInfo.windowId ? activeInfo.tabId : undefined;
    });
    await refreshTab(activeInfo.tabId);
  });
});

browser.windows.onFocusChanged.addListener((windowId) => {
  const eventTime = Date.now();
  queueTask(async () => {
    await accounted(eventTime, async () => {
      focusedWindowId = windowId;
      await selectActiveTab(windowId);
    });
    await refreshAllTabs();
  });
});

browser.tabs.onRemoved.addListener((tabId) => {
  const eventTime = Date.now();
  queueTask(() =>
    accounted(eventTime, () => {
      tabStates.delete(tabId);
      forgetPresentation(tabId);
      if (activeTabId === tabId) activeTabId = undefined;
    }),
  );
});

browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const eventTime = Date.now();
  queueTask(async () => {
    await accounted(eventTime, async () => {
      const previous = tabStates.get(removedTabId);
      tabStates.delete(removedTabId);
      forgetPresentation(removedTabId);
      const tab = await browser.tabs.get(addedTabId);
      tabStates.set(
        addedTabId,
        transitionTabState(previous, tab.url, settings.trackedHostnames, false),
      );
      if (activeTabId === removedTabId) activeTabId = addedTabId;
      if (previous?.inherited) await persistTabFlag(addedTabId, TAB_INHERITED_KEY, true);
      if (previous?.excluded) await persistTabFlag(addedTabId, TAB_EXCLUDED_KEY, true);
    });
    await representTab(addedTabId);
  });
});

browser.runtime.onMessage.addListener(
  (message: unknown, sender): Promise<ExtensionResponse> | undefined => {
    if (!isExtensionRequest(message)) return undefined;

    return enqueue(async () => {
      await ready;
      try {
        if (message.type === "get-status") {
          // A content script asks once per document load: a good moment to reapply its tab's toolbar values.
          if (sender.tab?.id !== undefined) await representTab(sender.tab.id);
        } else {
          await accounted(Date.now(), () => applyRequest(message));
          await refreshAllTabs();
        }
        const statusTabId =
          ("tabId" in message ? message.tabId : undefined) ?? sender.tab?.id ?? activeTabId;
        return { ok: true, status: snapshot(statusTabId) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
      }
    });
  },
);
