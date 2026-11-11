import type { Settings } from "./types.ts";

export const MS_PER_MINUTE = 60_000;

export const STORAGE_SETTINGS_KEY = "settings";
export const STORAGE_USAGE_KEY = "dailyUsage";
export const STORAGE_BLOCK_ALL_KEY = "blockAll";
export const STORAGE_BLOCK_TRACKED_KEY = "blockTracked";
export const TAB_INHERITED_KEY = "screenTimeInherited";
export const TAB_EXCLUDED_KEY = "screenTimeExcluded";

export const DEFAULT_SETTINGS: Settings = {
  trackedHostnames: [],
  dailyLimitMinutes: 30,
  showBadge: true,
  startDayPaused: false,
};
