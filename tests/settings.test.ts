import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.ts";
import { validateSettings } from "../src/shared/settings.ts";

const valid = { ...DEFAULT_SETTINGS, trackedHostnames: ["example.com"] };

describe("validateSettings", () => {
  test("normalizes hostnames and keeps valid values", () => {
    expect(
      validateSettings({
        dailyLimitMinutes: "45",
        trackedHostnames: ["https://B.example/x", "a.example", "b.example"],
        showBadge: false,
        startDayPaused: true,
        limitMode: "superstrict",
      }),
    ).toEqual({
      dailyLimitMinutes: 45,
      trackedHostnames: ["a.example", "b.example"],
      showBadge: false,
      startDayPaused: true,
      limitMode: "superstrict",
    });
  });

  test("falls back to defaults for missing or mistyped flags", () => {
    const settings = validateSettings({
      dailyLimitMinutes: 30,
      trackedHostnames: [],
      showBadge: "yes",
    });
    expect(settings.showBadge).toBe(DEFAULT_SETTINGS.showBadge);
    expect(settings.startDayPaused).toBe(DEFAULT_SETTINGS.startDayPaused);
    expect(settings.limitMode).toBe("regular");
  });

  test("migrates the legacy strict flag and rejects unknown modes", () => {
    expect(validateSettings({ ...valid, limitMode: undefined, strictMode: true }).limitMode).toBe(
      "strict",
    );
    expect(validateSettings({ ...valid, limitMode: undefined, strictMode: false }).limitMode).toBe(
      "regular",
    );
    expect(validateSettings({ ...valid, limitMode: "extreme" }).limitMode).toBe("regular");
    expect(validateSettings({ ...valid, limitMode: "strict", strictMode: false }).limitMode).toBe(
      "strict",
    );
    expect(validateSettings({ ...valid, strictMode: true })).not.toHaveProperty("strictMode");
  });

  test("rejects limits outside 1 to 1440 whole minutes", () => {
    for (const dailyLimitMinutes of [0, 1_441, 1.5, "abc", undefined]) {
      expect(() => validateSettings({ ...valid, dailyLimitMinutes })).toThrow("Daily limit");
    }
    expect(validateSettings({ ...valid, dailyLimitMinutes: 1_440 }).dailyLimitMinutes).toBe(1_440);
  });

  test("rejects a missing hostname list, invalid hostnames and non-objects", () => {
    expect(() => validateSettings({ ...valid, trackedHostnames: "example.com" })).toThrow(
      "must be a list",
    );
    expect(() => validateSettings({ ...valid, trackedHostnames: ["ftp://example.com"] })).toThrow(
      "Only HTTP and HTTPS",
    );
    expect(() => validateSettings(null)).toThrow("Daily limit");
  });
});
