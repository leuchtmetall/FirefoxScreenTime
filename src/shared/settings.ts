import { DEFAULT_SETTINGS } from "./constants.ts";
import { isLimitMode } from "./modes.ts";
import type { LimitMode, Settings } from "./types.ts";
import { normalizeHostnames } from "./urls.ts";

const MAX_DAILY_LIMIT_MINUTES = 1_440;

/** Checks and normalizes settings from storage or a request; throws a user-facing error if invalid. */
export function validateSettings(candidate: unknown): Settings {
  const { dailyLimitMinutes, trackedHostnames, showBadge, startDayPaused, limitMode, strictMode } =
    (candidate ?? {}) as Partial<Record<keyof Settings | "strictMode", unknown>>;
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
    limitMode: validLimitMode(limitMode, strictMode),
  };
}

/** Settings stored before superstrict mode existed had a `strictMode` flag instead of a mode. */
function validLimitMode(limitMode: unknown, legacyStrictMode: unknown): LimitMode {
  if (isLimitMode(limitMode)) return limitMode;
  return legacyStrictMode === true ? "strict" : DEFAULT_SETTINGS.limitMode;
}
