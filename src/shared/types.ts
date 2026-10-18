export const STORAGE_SETTINGS_KEY = "settings";
export const STORAGE_USAGE_KEY = "dailyUsage";
export const STORAGE_BLOCK_ALL_KEY = "blockAll";
export const TAB_INHERITED_KEY = "screenTimeInherited";
export const TAB_EXCLUDED_KEY = "screenTimeExcluded";

export interface Settings {
  trackedHostnames: string[];
  dailyLimitMinutes: number;
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
  url?: string;
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
  currentTabTracked: boolean;
  currentTabExcluded: boolean;
}

export type ExtensionRequest =
  | { type: "get-status"; tabId?: number }
  | { type: "set-tab-excluded"; tabId: number; excluded: boolean }
  | { type: "save-settings"; settings: Settings }
  | { type: "set-block-all"; enabled: boolean; tabId?: number }
  | { type: "extend"; durationMinutes: 5 | 15 | "rest-of-day" };

export type ExtensionResponse =
  | { ok: true; status: StatusSnapshot }
  | { ok: false; error: string };

export type ContentUpdate = {
  type: "tracking-update";
  mode: OverlayMode | undefined;
  status: StatusSnapshot;
};

/** Why a tab's content is covered: the daily limit was reached, or block-everything mode is on. */
export type OverlayMode = "limit" | "block-all";

export const DEFAULT_SETTINGS: Settings = {
  trackedHostnames: [],
  dailyLimitMinutes: 30,
};
