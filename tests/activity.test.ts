import { describe, expect, test } from "bun:test";
import { isTrackedTabInUse, shownTabs } from "../src/shared/activity.ts";

describe("shown tabs", () => {
  test("includes the active tab of every window that is not minimized, focused or not", () => {
    const windows = [
      { id: 1, state: "normal" },
      { id: 2, state: "maximized" },
      { id: 3, state: "fullscreen" },
    ];
    const tabs = [
      { id: 10, windowId: 1 },
      { id: 20, windowId: 2 },
      { id: 30, windowId: 3 },
    ];
    expect(shownTabs(windows, tabs).map((tab) => tab.id)).toEqual([10, 20, 30]);
  });

  test("excludes minimized windows and windows that aren't listed", () => {
    const windows = [
      { id: 1, state: "minimized" },
      { id: 2, state: "normal" },
    ];
    const tabs = [
      { id: 10, windowId: 1 },
      { id: 20, windowId: 2 },
      { id: 30, windowId: 3 },
    ];
    expect(shownTabs(windows, tabs).map((tab) => tab.id)).toEqual([20]);
  });

  test("counts a tab as audible only when it isn't muted", () => {
    const windows = [{ id: 1, state: "normal" }];
    const tabs = [
      { id: 10, windowId: 1, audible: true, mutedInfo: { muted: false } },
      { id: 11, windowId: 1, audible: true, mutedInfo: { muted: true } },
      { id: 12, windowId: 1, audible: false },
    ];
    expect(shownTabs(windows, tabs)).toEqual([
      { id: 10, audible: true },
      { id: 11, audible: false },
      { id: 12, audible: false },
    ]);
  });
});

describe("tracked tab in use", () => {
  const tracked = new Set([1]);
  const isTracked = (tabId: number) => tracked.has(tabId);

  test("runs while any shown tab is tracked", () => {
    const shown = [
      { id: 2, audible: false },
      { id: 1, audible: false },
    ];
    expect(isTrackedTabInUse(shown, isTracked, false)).toBe(true);
  });

  test("doesn't run without a shown tracked tab", () => {
    expect(isTrackedTabInUse([{ id: 2, audible: true }], isTracked, false)).toBe(false);
    expect(isTrackedTabInUse([], isTracked, false)).toBe(false);
  });

  test("pauses while the user is idle", () => {
    expect(isTrackedTabInUse([{ id: 1, audible: false }], isTracked, true)).toBe(false);
  });

  test("keeps running while idle if a shown tracked tab plays sound", () => {
    expect(isTrackedTabInUse([{ id: 1, audible: true }], isTracked, true)).toBe(true);
  });

  test("ignores sound from a shown tab that isn't tracked", () => {
    const shown = [
      { id: 1, audible: false },
      { id: 2, audible: true },
    ];
    expect(isTrackedTabInUse(shown, isTracked, true)).toBe(false);
  });
});
