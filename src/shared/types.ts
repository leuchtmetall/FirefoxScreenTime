export interface Settings {
  trackedHostnames: string[];
  dailyLimitMinutes: number;
  /** Show remaining minutes as a badge on the toolbar icon. */
  showBadge: boolean;
  /** Turn on block-tracked mode at the start of every day, so tracked sites must be un-paused first. */
  startDayPaused: boolean;
  limitMode: LimitMode;
}

/**
 * - `regular`: extensions of 5 or 15 minutes, or the rest of the day.
 * - `strict`: the only way past the daily limit is a single 5-minute extension per day.
 * - `superstrict`: strict, and additionally the allowance can't be raised, tracked sites can't be
 *   removed, tabs can't leave tracking, and switching to another mode only takes effect the next day.
 */
export type LimitMode = "regular" | "strict" | "superstrict";

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
  effectiveLimitMs: number;
  /** The daily limit is reached (regular mode); independent of block-everything mode. */
  blocked: boolean;
  /** Block-everything mode: every tab is blocked and the daily timer is paused. */
  blockAll: boolean;
  /** Block-tracked mode: tracked tabs are blocked regardless of remaining time; the timer is paused. */
  blockTracked: boolean;
  /** A mode switch requested in superstrict mode; it takes effect at the start of the next local day. */
  pendingLimitMode: LimitMode | undefined;
  currentTabTracked: boolean;
  currentTabExcluded: boolean;
}

export type ExtensionRequest =
  | { type: "get-status"; tabId?: number }
  | { type: "set-tab-excluded"; tabId: number; excluded: boolean }
  | { type: "track-tab"; tabId: number }
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
