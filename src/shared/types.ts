export const STORAGE_SETTINGS_KEY = "settings";
export const STORAGE_USAGE_KEY = "dailyUsage";
export const STORAGE_BLOCK_ALL_KEY = "blockAll";
export const STORAGE_BLOCK_TRACKED_KEY = "blockTracked";
export const TAB_INHERITED_KEY = "screenTimeInherited";
export const TAB_EXCLUDED_KEY = "screenTimeExcluded";

export interface Settings {
  trackedHostnames: string[];
  dailyLimitMinutes: number;
  /** Show remaining minutes as a badge on the toolbar icon. */
  showBadge: boolean;
  /** Turn on block-tracked mode at the start of every day, so tracked sites must be un-paused first. */
  startDayPaused: boolean;
}

export interface DailyUsage {
  dayKey: string;
  elapsedMs: number;
  extraMs: number;
  blockingDisabled: boolean;
}

export interface TabTrackingState {
  inherited: boolean;
  /** Manually removed from tracking by the user; persists across navigations for the tab's lifetime. */
  excluded: boolean;
  tracked: boolean;
}

export interface StatusSnapshot {
  settings: Settings;
  usage: DailyUsage;
  elapsedMs: number;
  effectiveLimitMs: number;
  /** The daily limit is reached (regular mode); independent of block-everything mode. */
  blocked: boolean;
  /** Block-everything mode: every tab is blocked and the daily timer is paused. */
  blockAll: boolean;
  /** Block-tracked mode: tracked tabs are blocked regardless of remaining time; the timer is paused. */
  blockTracked: boolean;
  currentTabTracked: boolean;
  currentTabExcluded: boolean;
}

export type ExtensionRequest =
  | { type: "get-status"; tabId?: number }
  | { type: "set-tab-excluded"; tabId: number; excluded: boolean }
  | { type: "save-settings"; settings: Settings }
  | { type: "set-block-all"; enabled: boolean; tabId?: number }
  | { type: "set-block-tracked"; enabled: boolean; tabId?: number }
  | { type: "extend"; durationMinutes: 5 | 15 | "rest-of-day" }
  | { type: "reset-today"; tabId?: number };

export type ExtendDuration = Extract<ExtensionRequest, { type: "extend" }>["durationMinutes"];

export type ExtensionResponse = { ok: true; status: StatusSnapshot } | { ok: false; error: string };

export type ContentUpdate = {
  type: "tracking-update";
  mode: OverlayMode | undefined;
  status: StatusSnapshot;
};

/** Why a tab's content is covered: the daily limit was reached, or a block mode is on. */
export type OverlayMode = "limit" | "block-all" | "block-tracked";

export const DEFAULT_SETTINGS: Settings = {
  trackedHostnames: [],
  dailyLimitMinutes: 30,
  showBadge: true,
  startDayPaused: false,
};
