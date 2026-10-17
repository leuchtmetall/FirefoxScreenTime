export const STORAGE_SETTINGS_KEY = "settings";
export const STORAGE_USAGE_KEY = "dailyUsage";
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
  blocked: boolean;
  currentTabTracked: boolean;
  currentTabExcluded: boolean;
}

export type ExtensionRequest =
  | { type: "get-status"; tabId?: number }
  | { type: "set-tab-excluded"; tabId: number; excluded: boolean }
  | { type: "save-settings"; settings: Settings }
  | { type: "extend"; durationMinutes: 5 | 15 | "rest-of-day" };

export type ExtensionResponse =
  | { ok: true; status: StatusSnapshot }
  | { ok: false; error: string };

export type ContentUpdate = {
  type: "tracking-update";
  blocked: boolean;
  status: StatusSnapshot;
};

export const DEFAULT_SETTINGS: Settings = {
  trackedHostnames: [],
  dailyLimitMinutes: 30,
};
