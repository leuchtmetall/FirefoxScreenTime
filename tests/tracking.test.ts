import { describe, expect, test } from "bun:test";
import { overlayMode, setTabExcluded, transitionTabState } from "../src/shared/tracking.ts";

const configured = ["example.com"];

describe("tab tracking transitions", () => {
  test("tracks configured URLs directly", () => {
    expect(
      transitionTabState(undefined, "https://www.example.com/page", configured, false),
    ).toEqual({
      inherited: false,
      excluded: false,
      tracked: true,
    });
  });

  test("retains tracking through normal navigation in an inherited tab", () => {
    const previous = { inherited: true, excluded: false, tracked: true };
    expect(transitionTabState(previous, "https://another.test", configured, false).tracked).toBe(
      true,
    );
  });

  test("clears inheritance when a non-tracked URL is typed", () => {
    const previous = { inherited: true, excluded: false, tracked: true };
    expect(transitionTabState(previous, "https://another.test", configured, true)).toEqual({
      inherited: false,
      excluded: false,
      tracked: false,
    });
  });

  test("keeps an inherited tab tracked when a configured URL is typed", () => {
    const previous = { inherited: true, excluded: false, tracked: true };
    expect(transitionTabState(previous, "https://example.com", configured, true).tracked).toBe(
      true,
    );
  });

  test("stops direct tracking after normal navigation away", () => {
    const previous = { inherited: false, excluded: false, tracked: true };
    expect(transitionTabState(previous, "https://another.test", configured, false).tracked).toBe(
      false,
    );
  });

  test("excluded tabs stay untracked across navigations to configured URLs", () => {
    const excluded = setTabExcluded(
      { inherited: true, excluded: false, tracked: true },
      "https://example.com",
      configured,
      true,
    );
    expect(excluded.tracked).toBe(false);
    expect(transitionTabState(excluded, "https://example.com/other", configured, false)).toEqual({
      inherited: true,
      excluded: true,
      tracked: false,
    });
  });

  test("re-including a tab restores direct and inherited tracking", () => {
    const excluded = { inherited: true, excluded: true, tracked: false };
    expect(setTabExcluded(excluded, "https://elsewhere.test", configured, false).tracked).toBe(
      true,
    );
  });
});

describe("overlay mode", () => {
  test("block-everything mode covers every tab", () => {
    expect(overlayMode({ blockAll: true, blockTracked: false, blocked: false }, false)).toBe(
      "block-all",
    );
    expect(overlayMode({ blockAll: true, blockTracked: false, blocked: true }, true)).toBe(
      "block-all",
    );
  });

  test("block-tracked mode covers tracked tabs regardless of remaining time", () => {
    expect(overlayMode({ blockAll: false, blockTracked: true, blocked: false }, true)).toBe(
      "block-tracked",
    );
    expect(overlayMode({ blockAll: false, blockTracked: true, blocked: true }, true)).toBe(
      "block-tracked",
    );
    expect(
      overlayMode({ blockAll: false, blockTracked: true, blocked: false }, false),
    ).toBeUndefined();
    expect(overlayMode({ blockAll: true, blockTracked: true, blocked: false }, false)).toBe(
      "block-all",
    );
  });

  test("regular mode only covers tracked tabs past the limit", () => {
    expect(overlayMode({ blockAll: false, blockTracked: false, blocked: true }, true)).toBe(
      "limit",
    );
    expect(
      overlayMode({ blockAll: false, blockTracked: false, blocked: true }, false),
    ).toBeUndefined();
    expect(
      overlayMode({ blockAll: false, blockTracked: false, blocked: false }, true),
    ).toBeUndefined();
  });
});
