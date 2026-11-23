import type { LimitMode, Settings } from "./types.ts";

export const LIMIT_MODES: readonly LimitMode[] = ["regular", "strict", "superstrict"];

export function isLimitMode(value: unknown): value is LimitMode {
  return typeof value === "string" && (LIMIT_MODES as readonly string[]).includes(value);
}

/** Strict and superstrict mode share strict's rules: a single 5-minute extension and no reset. */
export function isStrict(mode: LimitMode): boolean {
  return mode !== "regular";
}

export function modeLabel(mode: LimitMode): string {
  switch (mode) {
    case "regular":
      return "Regular";
    case "strict":
      return "Strict";
    case "superstrict":
      return "Superstrict";
  }
}

/**
 * Why superstrict mode (as saved) rejects the candidate settings: it may not raise the daily
 * allowance nor remove tracked sites. Returns undefined when the candidate is acceptable.
 */
export function superstrictViolation(saved: Settings, candidate: Settings): string | undefined {
  if (saved.limitMode !== "superstrict") return undefined;
  if (candidate.dailyLimitMinutes > saved.dailyLimitMinutes) {
    return "Superstrict mode doesn't allow raising the daily allowance.";
  }
  const removed = saved.trackedHostnames.filter(
    (hostname) => !candidate.trackedHostnames.includes(hostname),
  );
  if (removed.length > 0) {
    return `Superstrict mode doesn't allow removing tracked sites: ${removed.join(", ")}.`;
  }
  return undefined;
}
