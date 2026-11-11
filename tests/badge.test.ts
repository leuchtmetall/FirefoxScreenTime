import { describe, expect, test } from "bun:test";
import { badgeText } from "../src/shared/badge.ts";
import { DEFAULT_SETTINGS } from "../src/shared/constants.ts";

function status(
  overrides: {
    showBadge?: boolean;
    elapsedMs?: number;
    limitMs?: number;
    blockAll?: boolean;
    blockTracked?: boolean;
    blockingDisabled?: boolean;
  } = {},
) {
  return {
    settings: { ...DEFAULT_SETTINGS, showBadge: overrides.showBadge ?? true },
    usage: {
      dayKey: "2024-01-01",
      elapsedMs: overrides.elapsedMs ?? 0,
      extraMs: 0,
      blockingDisabled: overrides.blockingDisabled ?? false,
    },
    effectiveLimitMs: overrides.limitMs ?? 30 * 60_000,
    blockAll: overrides.blockAll ?? false,
    blockTracked: overrides.blockTracked ?? false,
  };
}

describe("badgeText", () => {
  test("is empty when disabled or a block mode is on", () => {
    expect(badgeText(status({ showBadge: false }))).toBe("");
    expect(badgeText(status({ blockAll: true }))).toBe("");
    expect(badgeText(status({ blockTracked: true }))).toBe("");
  });

  test("shows remaining minutes rounded up", () => {
    expect(badgeText(status())).toBe("30m");
    expect(badgeText(status({ elapsedMs: 60_001 }))).toBe("29m");
    expect(badgeText(status({ elapsedMs: 40 * 60_000 }))).toBe("0m");
  });

  test("handles open-for-today and large values", () => {
    expect(badgeText(status({ blockingDisabled: true }))).toBe("∞");
    expect(badgeText(status({ limitMs: 1_440 * 60_000 }))).toBe("24h");
  });
});
