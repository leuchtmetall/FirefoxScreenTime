import {
  addActiveInterval,
  effectiveLimitMs,
  freshDailyUsage,
  isDailyBlocked,
  remainingMs,
  rollUsageToNow,
} from "./shared/daily.ts";
import { badgeText } from "./shared/badge.ts";
import { overlayMode, setTabExcluded, transitionTabState } from "./shared/tracking.ts";
import {
  DEFAULT_SETTINGS,
  STORAGE_BLOCK_ALL_KEY,
  STORAGE_SETTINGS_KEY,
  STORAGE_USAGE_KEY,
  TAB_EXCLUDED_KEY,
  TAB_INHERITED_KEY,
  type ContentUpdate,
  type DailyUsage,
  type ExtendDuration,
  type ExtensionRequest,
  type ExtensionResponse,
  type OverlayMode,
  type Settings,
  type StatusSnapshot,
  type TabTrackingState,
} from "./shared/types.ts";
import { normalizeHostnames } from "./shared/urls.ts";

const CHECKPOINT_ALARM = "screen-time-checkpoint";
const REQUEST_TYPES = new Set<unknown>(["get-status", "save-settings", "extend", "set-tab-excluded", "set-block-all"]);
const tabStates = new Map<number, TabTrackingState>();

/** What each tab last displayed, so refreshes only call the browser APIs for values that changed. */
interface TabPresentation {
  icon: string;
  title: string;
  badgeColor: string;
  mode: OverlayMode | undefined;
}
const presented = new Map<number, TabPresentation>();
let presentedBadgeText: string | undefined;

let settings: Settings = DEFAULT_SETTINGS;
let usage: DailyUsage = freshDailyUsage(Date.now());
/** Block-everything mode: all tabs are covered and the daily timer is paused. Persists until toggled off. */
let blockAll = false;
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
  const stored = await browser.storage.local.get([STORAGE_SETTINGS_KEY, STORAGE_USAGE_KEY, STORAGE_BLOCK_ALL_KEY]);
  blockAll = stored[STORAGE_BLOCK_ALL_KEY] === true;
  const storedUsage = stored[STORAGE_USAGE_KEY] as DailyUsage | undefined;

  if (stored[STORAGE_SETTINGS_KEY] !== undefined) settings = validateSettings(stored[STORAGE_SETTINGS_KEY]);
  usage = rollUsageToNow(storedUsage ?? freshDailyUsage(now), now);

  const [tabs, lastFocused] = await Promise.all([
    browser.tabs.query({}),
    browser.windows.getLastFocused(),
  ]);
  focusedWindowId = lastFocused.focused ? (lastFocused.id ?? browser.windows.WINDOW_ID_NONE) : browser.windows.WINDOW_ID_NONE;

  await Promise.all(tabs.map(async (tab) => {
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
  }));

  await browser.storage.local.set({
    [STORAGE_SETTINGS_KEY]: settings,
    [STORAGE_USAGE_KEY]: usage,
  });
  await browser.action.setBadgeTextColor({ color: "#ffffff" }).catch(ignore);
  beginActiveSession(now);
  await refreshAllTabs();
}

const ready = initialize();

function validateSettings(candidate: unknown): Settings {
  const { dailyLimitMinutes, trackedHostnames, showBadge } = (candidate ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const limit = Number(dailyLimitMinutes);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_440) {
    throw new Error("Daily limit must be a whole number from 1 to 1440 minutes.");
  }
  if (!Array.isArray(trackedHostnames)) throw new Error("Tracked hostnames must be a list.");
  return {
    dailyLimitMinutes: limit,
    trackedHostnames: normalizeHostnames(trackedHostnames),
    showBadge: typeof showBadge === "boolean" ? showBadge : DEFAULT_SETTINGS.showBadge,
  };
}

function canAccumulate(): boolean {
  if (blockAll) return false;
  if (activeTabId === undefined || focusedWindowId === browser.windows.WINDOW_ID_NONE) return false;
  return tabStates.get(activeTabId)?.tracked === true && !isDailyBlocked(usage, settings.dailyLimitMinutes);
}

function beginActiveSession(now: number): void {
  activeStartedAt = canAccumulate() ? now : undefined;
}

/** Usage including the active interval that has not been settled yet. */
function accruedUsage(now: number): DailyUsage {
  const current = rollUsageToNow(usage, now);
  if (activeStartedAt === undefined) return current;
  const accrued = addActiveInterval(current, activeStartedAt, now);
  if (accrued.blockingDisabled) return accrued;
  return { ...accrued, elapsedMs: Math.min(accrued.elapsedMs, effectiveLimitMs(accrued, settings.dailyLimitMinutes)) };
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
  if (usage !== previous) await saveUsage();
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

function snapshot(tabId = activeTabId): StatusSnapshot {
  const current = accruedUsage(Math.max(Date.now(), lastAccountingAt));
  const state = tabId === undefined ? undefined : tabStates.get(tabId);
  return {
    settings,
    usage: current,
    elapsedMs: current.elapsedMs,
    effectiveLimitMs: effectiveLimitMs(current, settings.dailyLimitMinutes),
    blocked: isDailyBlocked(current, settings.dailyLimitMinutes),
    blockAll,
    currentTabTracked: state?.tracked === true,
    currentTabExcluded: state?.excluded === true,
  };
}

function tabTitle(state: TabTrackingState | undefined, status: StatusSnapshot): string {
  if (status.blockAll) return "Screen Time: blocking everything";
  if (state?.tracked) {
    return status.blocked
      ? "Screen Time: daily limit reached"
      : `Screen Time: tracked, ${Math.ceil(remainingMs(status) / 60_000)} min remaining`;
  }
  return state?.excluded ? "Screen Time: removed from tracking" : "Screen Time: not tracked";
}

async function refreshBadgeText(status: StatusSnapshot): Promise<void> {
  const text = badgeText(status);
  if (text === presentedBadgeText) return;
  presentedBadgeText = text;
  await browser.action.setBadgeText({ text }).catch(ignore);
}

async function refreshTab(tabId: number): Promise<void> {
  const state = tabStates.get(tabId);
  const status = snapshot(tabId);
  const tracked = state?.tracked === true;
  const next: TabPresentation = {
    icon: tracked || blockAll ? "icons/active.svg" : "icons/inactive.svg",
    title: tabTitle(state, status),
    badgeColor: tracked ? (status.blocked ? "#17231f" : "#d85832") : "#6b7570",
    mode: overlayMode(status, tracked),
  };
  const previous = presented.get(tabId);
  presented.set(tabId, next);

  const updates: Promise<unknown>[] = [refreshBadgeText(status)];
  if (next.icon !== previous?.icon) updates.push(browser.action.setIcon({ tabId, path: next.icon }));
  if (next.title !== previous?.title) updates.push(browser.action.setTitle({ tabId, title: next.title }));
  if (next.badgeColor !== previous?.badgeColor) {
    updates.push(browser.action.setBadgeBackgroundColor({ tabId, color: next.badgeColor }));
  }
  if (!previous || next.mode !== previous.mode) {
    const update: ContentUpdate = { type: "tracking-update", mode: next.mode, status };
    updates.push(browser.tabs.sendMessage(tabId, update));
  }
  await Promise.all(updates.map((update) => update.catch(ignore)));
}

/** Forgets what a tab displays, e.g. after Firefox reset its toolbar values or it loaded a new document. */
async function representTab(tabId: number): Promise<void> {
  presented.delete(tabId);
  await refreshTab(tabId);
}

async function refreshAllTabs(): Promise<void> {
  await Promise.all([...tabStates.keys()].map(refreshTab));
}

async function checkpoint(): Promise<void> {
  const previous = usage;
  await accounted(Date.now(), ignore);
  // With no active tracked tab and no day rollover, nothing visible can have changed.
  if (usage !== previous) await refreshAllTabs();
}

async function setTabState(tabId: number, url: string | undefined, typedNavigation: boolean): Promise<void> {
  const previous = tabStates.get(tabId);
  const next = transitionTabState(previous, url, settings.trackedHostnames, typedNavigation);
  tabStates.set(tabId, next);
  if (previous?.inherited !== next.inherited) {
    await browser.sessions.setTabValue(tabId, TAB_INHERITED_KEY, next.inherited).catch(ignore);
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
  await Promise.all(tabs.map((tab) => tab.id === undefined ? undefined : setTabState(tab.id, tab.url, false)));
}

async function setBlockAll(enabled: unknown): Promise<void> {
  if (typeof enabled !== "boolean") throw new Error("Invalid block-everything request.");
  blockAll = enabled;
  await browser.storage.local.set({ [STORAGE_BLOCK_ALL_KEY]: blockAll });
}

async function setTabExclusion(tabId: unknown, excluded: unknown): Promise<void> {
  if (typeof tabId !== "number" || typeof excluded !== "boolean") throw new Error("Invalid tab request.");
  const tab = await browser.tabs.get(tabId);
  tabStates.set(tabId, setTabExcluded(tabStates.get(tabId), tab.url, settings.trackedHostnames, excluded));
  await browser.sessions.setTabValue(tabId, TAB_EXCLUDED_KEY, excluded).catch(ignore);
}

async function extend(durationMinutes: ExtendDuration): Promise<void> {
  if (blockAll) throw new Error("Turn off block-everything mode first.");
  if (durationMinutes === "rest-of-day") {
    usage = { ...usage, blockingDisabled: true };
  } else if (durationMinutes === 5 || durationMinutes === 15) {
    usage = { ...usage, extraMs: usage.extraMs + durationMinutes * 60_000 };
  } else {
    throw new Error("Invalid extension duration.");
  }
  await saveUsage();
}

async function applyRequest(request: Exclude<ExtensionRequest, { type: "get-status" }>): Promise<void> {
  switch (request.type) {
    case "save-settings":
      return saveSettings(request.settings);
    case "set-block-all":
      return setBlockAll(request.enabled);
    case "set-tab-excluded":
      return setTabExclusion(request.tabId, request.excluded);
    case "extend":
      return extend(request.durationMinutes);
  }
}

function isExtensionRequest(message: unknown): message is ExtensionRequest {
  return typeof message === "object" && message !== null && REQUEST_TYPES.has((message as { type?: unknown }).type);
}

browser.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: 0.25 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECKPOINT_ALARM) queueTask(checkpoint);
});

browser.tabs.onCreated.addListener((tab) => {
  queueTask(async () => {
    if (tab.id === undefined) return;
    const openerTracked = tab.openerTabId !== undefined && tabStates.get(tab.openerTabId)?.tracked === true;
    const state = transitionTabState(
      { inherited: openerTracked, excluded: false, tracked: openerTracked },
      tab.url,
      settings.trackedHostnames,
      false,
    );
    tabStates.set(tab.id, state);
    if (state.inherited) await browser.sessions.setTabValue(tab.id, TAB_INHERITED_KEY, true).catch(ignore);
    await refreshTab(tab.id);
  });
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const typedNavigation = details.transitionType === "typed"
    || details.transitionQualifiers.includes("from_address_bar");
  queueTask(async () => {
    await accounted(details.timeStamp, () => setTabState(details.tabId, details.url, typedNavigation));
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
  queueTask(() => accounted(eventTime, () => {
    tabStates.delete(tabId);
    presented.delete(tabId);
    if (activeTabId === tabId) activeTabId = undefined;
  }));
});

browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const eventTime = Date.now();
  queueTask(async () => {
    await accounted(eventTime, async () => {
      const previous = tabStates.get(removedTabId);
      tabStates.delete(removedTabId);
      presented.delete(removedTabId);
      const tab = await browser.tabs.get(addedTabId);
      tabStates.set(addedTabId, transitionTabState(previous, tab.url, settings.trackedHostnames, false));
      if (activeTabId === removedTabId) activeTabId = addedTabId;
      if (previous?.inherited) await browser.sessions.setTabValue(addedTabId, TAB_INHERITED_KEY, true).catch(ignore);
      if (previous?.excluded) await browser.sessions.setTabValue(addedTabId, TAB_EXCLUDED_KEY, true).catch(ignore);
    });
    await representTab(addedTabId);
  });
});

browser.runtime.onMessage.addListener((message: unknown, sender): Promise<ExtensionResponse> | undefined => {
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
      const statusTabId = ("tabId" in message ? message.tabId : undefined) ?? sender.tab?.id ?? activeTabId;
      return { ok: true, status: snapshot(statusTabId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  });
});
