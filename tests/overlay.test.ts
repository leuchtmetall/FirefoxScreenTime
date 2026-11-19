import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.ts";
import { freshDailyUsage } from "../src/shared/daily.ts";
import { overlayViewKey } from "../src/shared/overlay.ts";

const usage = freshDailyUsage(new Date(2026, 10, 19, 12).getTime());
const regular = { settings: DEFAULT_SETTINGS, usage };
const strict = { settings: { ...DEFAULT_SETTINGS, strictMode: true }, usage };

describe("overlay view key", () => {
  test("changes the time-up view when switching between regular and strict mode", () => {
    expect(overlayViewKey("limit", regular)).not.toBe(overlayViewKey("limit", strict));
  });

  test("changes the strict time-up view once today's extension is used", () => {
    const extended = { ...strict, usage: { ...usage, extraMs: 5 * 60_000 } };
    expect(overlayViewKey("limit", strict)).not.toBe(overlayViewKey("limit", extended));
  });

  test("ignores settings for the block modes and no overlay", () => {
    expect(overlayViewKey("block-all", regular)).toBe(overlayViewKey("block-all", strict));
    expect(overlayViewKey("block-tracked", regular)).toBe(overlayViewKey("block-tracked", strict));
    expect(overlayViewKey(undefined, strict)).toBeUndefined();
  });
});
