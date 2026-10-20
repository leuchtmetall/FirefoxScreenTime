import {
  addActiveInterval,
  effectiveLimitMs,
  freshDailyUsage,
  isDailyBlocked,
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
  type ExtensionRequest,
  type ExtensionResponse,
  type Settings,
  type StatusSnapshot,
  type TabTrackingState,
} from "./shared/types.ts";
import { normalizeHostnames } from "./shared/urls.ts";

const CHECKPOINT_ALARM = "screen-time-checkpoint";
const tabStates = new Map<number, TabTrackingState>();

let settings: Settings = DEFAULT_SETTINGS;
let usage: DailyUsage = freshDailyUsage(Date.now());
/** Block-everything mode: all tabs are covered and the daily timer is paused. Persists until toggled off. */
let blockAll = false;
let focusedWindowId = browser.windows.WINDOW_ID_NONE;
let activeTabId: number | undefined;
let activeStartedAt: number | undefined;
let lastAccountingAt = Date.now();
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    (error: unknown) => console.error("Screen Time operation failed", error),
  );
  return result;
}

async function initialize(): Promise<void> {
  const now = Date.now();
  const stored = await browser.storage.local.get([STORAGE_SETTINGS_KEY, STORAGE_USAGE_KEY, STORAGE_BLOCK_ALL_KEY]);
  blockAll = stored[STORAGE_BLOCK_ALL_KEY] === true;
  const storedSettings = stored[STORAGE_SETTINGS_KEY] as Settings | undefined;
  const storedUsage = stored[STORAGE_USAGE_KEY] as DailyUsage | undefined;

  if (storedSettings) settings = validateSettings(storedSettings);
  usage = rollUsageToNow(storedUsage ?? freshDailyUsage(now), now);

  const [tabs, lastFocused] = await Promise.all([
    browser.tabs.query({}),
    browser.windows.getLastFocused(),
  ]);
  focusedWindowId = lastFocused.focused ? (lastFocused.id ?? browser.windows.WINDOW_ID_NONE) : browser.windows.WINDOW_ID_NONE;

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
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
  }

  await browser.storage.local.set({
    [STORAGE_SETTINGS_KEY]: settings,
    [STORAGE_USAGE_KEY]: usage,
  });
  beginActiveSession(now);
  await refreshAllTabs();
}

const ready = initialize();

function validateSettings(candidate: Settings): Settings {
  const dailyLimitMinutes = Number(candidate.dailyLimitMinutes);
  if (!Number.isInteger(dailyLimitMinutes) || dailyLimitMinutes < 1 || dailyLimitMinutes > 1_440) {
    throw new Error("Daily limit must be a whole number from 1 to 1440 minutes.");
  }
  if (!Array.isArray(candidate.trackedHostnames)) throw new Error("Tracked hostnames must be a list.");
  return {
    dailyLimitMinutes,
    trackedHostnames: normalizeHostnames(candidate.trackedHostnames),
    showBadge: candidate.showBadge === true,
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

async function settle(eventTime: number): Promise<number> {
  const now = Math.max(eventTime, lastAccountingAt);
  lastAccountingAt = now;
  usage = rollUsageToNow(usage, now);
  if (activeStartedAt !== undefined) {
    usage = addActiveInterval(usage, activeStartedAt, now);
    if (!usage.blockingDisabled) {
      usage.elapsedMs = Math.min(usage.elapsedMs, effectiveLimitMs(usage, settings.dailyLimitMinutes));
    }
  }
  activeStartedAt = undefined;
  await browser.storage.local.set({ [STORAGE_USAGE_KEY]: usage });
  return now;
}

function snapshot(tabId = activeTabId): StatusSnapshot {
  return {
    settings,
    usage,
    elapsedMs: usage.elapsedMs,
    effectiveLimitMs: effectiveLimitMs(usage, settings.dailyLimitMinutes),
    blocked: isDailyBlocked(usage, settings.dailyLimitMinutes),
    blockAll,
    currentTabTracked: tabId !== undefined && tabStates.get(tabId)?.tracked === true,
    currentTabExcluded: tabId !== undefined && tabStates.get(tabId)?.excluded === true,
  };
}

async function refreshTab(tabId: number): Promise<void> {
  const state = tabStates.get(tabId);
  const status = snapshot(tabId);
  const tracked = state?.tracked === true;
  const update: ContentUpdate = {
    type: "tracking-update",
    mode: overlayMode(status, tracked),
    status,
  };
  const title = blockAll
    ? "Screen Time: blocking everything"
    : tracked
      ? status.blocked
        ? "Screen Time: daily limit reached"
        : `Screen Time: tracked, ${formatRemaining(status)} remaining`
      : state?.excluded
        ? "Screen Time: removed from tracking"
        : "Screen Time: not tracked";

  await Promise.all([
    browser.action.setIcon({
      tabId,
      path: tracked || blockAll ? "icons/active.svg" : "icons/inactive.svg",
    }).catch(() => undefined),
    browser.action.setTitle({ tabId, title }).catch(() => undefined),
    browser.action.setBadgeText({ tabId, text: badgeText(status) }).catch(() => undefined),
    browser.action.setBadgeBackgroundColor({
      tabId,
      color: tracked ? (status.blocked ? "#17231f" : "#d85832") : "#6b7570",
    }).catch(() => undefined),
    browser.action.setBadgeTextColor({ tabId, color: "#ffffff" }).catch(() => undefined),
    browser.tabs.sendMessage(tabId, update).catch(() => undefined),
  ]);
}

function formatRemaining(status: StatusSnapshot): string {
  const remainingMinutes = Math.max(0, Math.ceil((status.effectiveLimitMs - status.elapsedMs) / 60_000));
  return `${remainingMinutes} min`;
}

async function refreshAllTabs(): Promise<void> {
  await Promise.all([...tabStates.keys()].map(refreshTab));
}

async function checkpoint(): Promise<void> {
  const now = await settle(Date.now());
  beginActiveSession(now);
  await refreshAllTabs();
}

async function setTabState(tabId: number, url: string | undefined, typedNavigation: boolean): Promise<void> {
  const previous = tabStates.get(tabId);
  const next = transitionTabState(previous, url, settings.trackedHostnames, typedNavigation);
  tabStates.set(tabId, next);
  if (previous?.inherited !== next.inherited) {
    await browser.sessions.setTabValue(tabId, TAB_INHERITED_KEY, next.inherited).catch(() => undefined);
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

browser.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: 0.25 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECKPOINT_ALARM) void enqueue(async () => {
    await ready;
    await checkpoint();
  });
});

browser.tabs.onCreated.addListener((tab) => {
  void enqueue(async () => {
    await ready;
    if (tab.id === undefined) return;
    const openerTracked = tab.openerTabId !== undefined && tabStates.get(tab.openerTabId)?.tracked === true;
    const state = transitionTabState(
      { inherited: openerTracked, excluded: false, tracked: openerTracked },
      tab.url,
      settings.trackedHostnames,
      false,
    );
    tabStates.set(tab.id, state);
    if (state.inherited) await browser.sessions.setTabValue(tab.id, TAB_INHERITED_KEY, true).catch(() => undefined);
    await refreshTab(tab.id);
  });
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const eventTime = details.timeStamp;
  void enqueue(async () => {
    await ready;
    const now = await settle(eventTime);
    const typedNavigation = details.transitionType === "typed"
      || details.transitionQualifiers.includes("from_address_bar");
    await setTabState(details.tabId, details.url, typedNavigation);
    beginActiveSession(now);
    await refreshTab(details.tabId);
  });
});

browser.tabs.onActivated.addListener((activeInfo) => {
  const eventTime = Date.now();
  void enqueue(async () => {
    await ready;
    const now = await settle(eventTime);
    activeTabId = focusedWindowId === activeInfo.windowId ? activeInfo.tabId : undefined;
    beginActiveSession(now);
    await refreshTab(activeInfo.tabId);
  });
});

browser.windows.onFocusChanged.addListener((windowId) => {
  const eventTime = Date.now();
  void enqueue(async () => {
    await ready;
    const now = await settle(eventTime);
    focusedWindowId = windowId;
    await selectActiveTab(windowId);
    beginActiveSession(now);
    await refreshAllTabs();
  });
});

browser.tabs.onRemoved.addListener((tabId) => {
  const eventTime = Date.now();
  void enqueue(async () => {
    await ready;
    const now = await settle(eventTime);
    tabStates.delete(tabId);
    if (activeTabId === tabId) activeTabId = undefined;
    beginActiveSession(now);
  });
});

browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const eventTime = Date.now();
  void enqueue(async () => {
    await ready;
    const now = await settle(eventTime);
    const previous = tabStates.get(removedTabId);
    tabStates.delete(removedTabId);
    const tab = await browser.tabs.get(addedTabId);
    tabStates.set(addedTabId, transitionTabState(previous, tab.url, settings.trackedHostnames, false));
    if (activeTabId === removedTabId) activeTabId = addedTabId;
    if (previous?.inherited) await browser.sessions.setTabValue(addedTabId, TAB_INHERITED_KEY, true).catch(() => undefined);
    if (previous?.excluded) await browser.sessions.setTabValue(addedTabId, TAB_EXCLUDED_KEY, true).catch(() => undefined);
    beginActiveSession(now);
    await refreshTab(addedTabId);
  });
});

browser.runtime.onMessage.addListener((message: unknown, sender): Promise<ExtensionResponse> | undefined => {
  const request = message as Partial<ExtensionRequest>;
  if (
    request.type !== "get-status"
    && request.type !== "save-settings"
    && request.type !== "extend"
    && request.type !== "set-tab-excluded"
    && request.type !== "set-block-all"
  ) return undefined;

  return enqueue(async () => {
    await ready;
    const now = await settle(Date.now());

    try {
      if (request.type === "save-settings") {
        settings = validateSettings(request.settings as Settings);
        await browser.storage.local.set({ [STORAGE_SETTINGS_KEY]: settings });
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
          if (tab.id !== undefined) await setTabState(tab.id, tab.url, false);
        }
      } else if (request.type === "set-block-all") {
        if (typeof request.enabled !== "boolean") throw new Error("Invalid block-everything request.");
        blockAll = request.enabled;
        await browser.storage.local.set({ [STORAGE_BLOCK_ALL_KEY]: blockAll });
      } else if (request.type === "set-tab-excluded") {
        const tabId = request.tabId;
        if (typeof tabId !== "number" || typeof request.excluded !== "boolean") throw new Error("Invalid tab request.");
        const tab = await browser.tabs.get(tabId);
        tabStates.set(tabId, setTabExcluded(tabStates.get(tabId), tab.url, settings.trackedHostnames, request.excluded));
        await browser.sessions.setTabValue(tabId, TAB_EXCLUDED_KEY, request.excluded).catch(() => undefined);
      } else if (request.type === "extend") {
        if (blockAll) throw new Error("Turn off block-everything mode first.");
        if (request.durationMinutes === "rest-of-day") {
          usage.blockingDisabled = true;
        } else if (request.durationMinutes === 5 || request.durationMinutes === 15) {
          usage.extraMs += request.durationMinutes * 60_000;
        } else {
          throw new Error("Invalid extension duration.");
        }
        await browser.storage.local.set({ [STORAGE_USAGE_KEY]: usage });
      }

      beginActiveSession(now);
      await refreshAllTabs();
      const statusTabId = request.type === "set-tab-excluded" || request.type === "get-status" || request.type === "set-block-all"
        ? (request.tabId ?? sender.tab?.id)
        : sender.tab?.id;
      return { ok: true, status: snapshot(statusTabId ?? activeTabId) };
    } catch (error) {
      beginActiveSession(now);
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  });
});
