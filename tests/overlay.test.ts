import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.ts";
import { freshDailyUsage } from "../src/shared/daily.ts";
import { isReloadShortcut, overlayViewKey } from "../src/shared/overlay.ts";

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

describe("reload shortcut", () => {
  const key = (
    key: string,
    modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {},
  ) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  });

  test("recognises Cmd+R, Ctrl+Shift+R and F5", () => {
    expect(isReloadShortcut(key("r", { metaKey: true }))).toBe(true);
    expect(isReloadShortcut(key("R", { ctrlKey: true }))).toBe(true);
    expect(isReloadShortcut(key("F5"))).toBe(true);
  });

  test("leaves other keys blocked", () => {
    expect(isReloadShortcut(key("r"))).toBe(false);
    expect(isReloadShortcut(key("r", { metaKey: true, altKey: true }))).toBe(false);
    expect(isReloadShortcut(key("ArrowDown", { metaKey: true }))).toBe(false);
  });
});
