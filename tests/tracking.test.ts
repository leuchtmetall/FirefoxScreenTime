import { describe, expect, test } from "bun:test";
import { overlayMode, setTabExcluded, transitionTabState } from "../src/shared/tracking.ts";

const configured = ["example.com"];

describe("tab tracking transitions", () => {
  test("tracks configured URLs directly", () => {
    expect(transitionTabState(undefined, "https://www.example.com/page", configured, false)).toEqual({
      inherited: false,
      excluded: false,
      tracked: true,
      url: "https://www.example.com/page",
    });
  });

  test("retains tracking through normal navigation in an inherited tab", () => {
    const previous = { inherited: true, excluded: false, tracked: true, url: "https://elsewhere.test" };
    expect(transitionTabState(previous, "https://another.test", configured, false).tracked).toBe(true);
  });

  test("clears inheritance when a non-tracked URL is typed", () => {
    const previous = { inherited: true, excluded: false, tracked: true, url: "https://elsewhere.test" };
    expect(transitionTabState(previous, "https://another.test", configured, true)).toEqual({
      inherited: false,
      excluded: false,
      tracked: false,
      url: "https://another.test",
    });
  });

  test("keeps an inherited tab tracked when a configured URL is typed", () => {
    const previous = { inherited: true, excluded: false, tracked: true, url: "https://elsewhere.test" };
    expect(transitionTabState(previous, "https://example.com", configured, true).tracked).toBe(true);
  });

  test("stops direct tracking after normal navigation away", () => {
    const previous = { inherited: false, excluded: false, tracked: true, url: "https://example.com" };
    expect(transitionTabState(previous, "https://another.test", configured, false).tracked).toBe(false);
  });

  test("excluded tabs stay untracked across navigations to configured URLs", () => {
    const excluded = setTabExcluded(
      { inherited: true, excluded: false, tracked: true, url: "https://example.com" },
      "https://example.com",
      configured,
      true,
    );
    expect(excluded.tracked).toBe(false);
    expect(transitionTabState(excluded, "https://example.com/other", configured, false)).toEqual({
      inherited: true,
      excluded: true,
      tracked: false,
      url: "https://example.com/other",
    });
  });

  test("re-including a tab restores direct and inherited tracking", () => {
    const excluded = { inherited: true, excluded: true, tracked: false, url: "https://elsewhere.test" };
    expect(setTabExcluded(excluded, "https://elsewhere.test", configured, false).tracked).toBe(true);
  });
});

describe("overlay mode", () => {
  test("block-everything mode covers every tab", () => {
    expect(overlayMode({ blockAll: true, blocked: false }, false)).toBe("block-all");
    expect(overlayMode({ blockAll: true, blocked: true }, true)).toBe("block-all");
  });

  test("regular mode only covers tracked tabs past the limit", () => {
    expect(overlayMode({ blockAll: false, blocked: true }, true)).toBe("limit");
    expect(overlayMode({ blockAll: false, blocked: true }, false)).toBeUndefined();
    expect(overlayMode({ blockAll: false, blocked: false }, true)).toBeUndefined();
  });
});
