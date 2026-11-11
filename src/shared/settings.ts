import { DEFAULT_SETTINGS } from "./constants.ts";
import type { Settings } from "./types.ts";
import { normalizeHostnames } from "./urls.ts";

const MAX_DAILY_LIMIT_MINUTES = 1_440;

/** Checks and normalizes settings from storage or a request; throws a user-facing error if invalid. */
export function validateSettings(candidate: unknown): Settings {
  const { dailyLimitMinutes, trackedHostnames, showBadge, startDayPaused } = (candidate ??
    {}) as Partial<Record<keyof Settings, unknown>>;
  const limit = Number(dailyLimitMinutes);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DAILY_LIMIT_MINUTES) {
    throw new Error(
      `Daily limit must be a whole number from 1 to ${MAX_DAILY_LIMIT_MINUTES} minutes.`,
    );
  }
  if (!Array.isArray(trackedHostnames)) throw new Error("Tracked hostnames must be a list.");
  return {
    dailyLimitMinutes: limit,
    trackedHostnames: normalizeHostnames(trackedHostnames),
    showBadge: typeof showBadge === "boolean" ? showBadge : DEFAULT_SETTINGS.showBadge,
    startDayPaused:
      typeof startDayPaused === "boolean" ? startDayPaused : DEFAULT_SETTINGS.startDayPaused,
  };
}
