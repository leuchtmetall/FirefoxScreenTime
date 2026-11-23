import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.ts";
import { isStrict, superstrictViolation } from "../src/shared/modes.ts";
import type { Settings } from "../src/shared/types.ts";

const saved: Settings = {
  ...DEFAULT_SETTINGS,
  limitMode: "superstrict",
  dailyLimitMinutes: 30,
  trackedHostnames: ["a.example", "b.example"],
};

describe("isStrict", () => {
  test("covers strict and superstrict mode", () => {
    expect(isStrict("regular")).toBe(false);
    expect(isStrict("strict")).toBe(true);
    expect(isStrict("superstrict")).toBe(true);
  });
});

describe("superstrictViolation", () => {
  test("allows lowering the allowance, adding sites and switching mode", () => {
    expect(
      superstrictViolation(saved, {
        ...saved,
        limitMode: "regular",
        dailyLimitMinutes: 20,
        trackedHostnames: ["a.example", "b.example", "c.example"],
      }),
    ).toBeUndefined();
  });

  test("rejects raising the allowance", () => {
    expect(superstrictViolation(saved, { ...saved, dailyLimitMinutes: 31 })).toContain(
      "raising the daily allowance",
    );
  });

  test("rejects removing tracked sites and names them", () => {
    expect(superstrictViolation(saved, { ...saved, trackedHostnames: ["c.example"] })).toBe(
      "Superstrict mode doesn't allow removing tracked sites: a.example, b.example.",
    );
  });

  test("applies only when the saved mode is superstrict", () => {
    for (const limitMode of ["regular", "strict"] as const) {
      expect(
        superstrictViolation(
          { ...saved, limitMode },
          { ...saved, limitMode: "superstrict", dailyLimitMinutes: 60, trackedHostnames: [] },
        ),
      ).toBeUndefined();
    }
  });
});
