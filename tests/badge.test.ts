import { describe, expect, test } from "bun:test";
import { badgeText } from "../src/shared/badge.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";

function status(overrides: { showBadge?: boolean; elapsedMs?: number; limitMs?: number; blockAll?: boolean; blockingDisabled?: boolean } = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, showBadge: overrides.showBadge ?? true },
    usage: { dayKey: "2024-01-01", elapsedMs: 0, extraMs: 0, blockingDisabled: overrides.blockingDisabled ?? false },
    elapsedMs: overrides.elapsedMs ?? 0,
    effectiveLimitMs: overrides.limitMs ?? 30 * 60_000,
    blockAll: overrides.blockAll ?? false,
  };
}

describe("badgeText", () => {
  test("is empty when disabled or blocking everything", () => {
    expect(badgeText(status({ showBadge: false }))).toBe("");
    expect(badgeText(status({ blockAll: true }))).toBe("");
  });

  test("shows remaining minutes rounded up", () => {
    expect(badgeText(status())).toBe("30");
    expect(badgeText(status({ elapsedMs: 60_001 }))).toBe("29");
    expect(badgeText(status({ elapsedMs: 40 * 60_000 }))).toBe("0");
  });

  test("handles open-for-today and large values", () => {
    expect(badgeText(status({ blockingDisabled: true }))).toBe("∞");
    expect(badgeText(status({ limitMs: 1_440 * 60_000 }))).toBe("24h");
  });
});
