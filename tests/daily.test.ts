import { describe, expect, test } from "bun:test";
import {
  addActiveInterval,
  effectiveLimitMs,
  freshDailyUsage,
  isDailyBlocked,
  localDayKey,
  rollUsageToNow,
  startOfLocalDay,
} from "../src/shared/daily.ts";

describe("daily accounting", () => {
  test("adds an active interval", () => {
    const now = new Date(2026, 7, 22, 12).getTime();
    const usage = freshDailyUsage(now);
    expect(addActiveInterval(usage, now - 5_000, now).elapsedMs).toBe(5_000);
  });

  test("resets usage and extensions on a new local day", () => {
    const yesterday = new Date(2026, 7, 21, 23, 59).getTime();
    const today = new Date(2026, 7, 22, 0, 1).getTime();
    const usage = { ...freshDailyUsage(yesterday), elapsedMs: 60_000, extraMs: 300_000, blockingDisabled: true };
    expect(rollUsageToNow(usage, today)).toEqual(freshDailyUsage(today));
  });

  test("counts only today's portion of an interval crossing midnight", () => {
    const now = new Date(2026, 7, 22, 0, 0, 10).getTime();
    const usage = freshDailyUsage(new Date(2026, 7, 21, 23, 59).getTime());
    expect(addActiveInterval(usage, now - 20_000, now).elapsedMs).toBe(now - startOfLocalDay(now));
  });

  test("uses base and temporary allowance", () => {
    const now = Date.now();
    const usage = { ...freshDailyUsage(now), elapsedMs: 35 * 60_000, extraMs: 5 * 60_000 };
    expect(effectiveLimitMs(usage, 30)).toBe(35 * 60_000);
    expect(isDailyBlocked(usage, 30)).toBe(true);
    expect(isDailyBlocked({ ...usage, blockingDisabled: true }, 30)).toBe(false);
  });

  test("uses a stable local date key", () => {
    const timestamp = new Date(2026, 0, 2, 23, 59).getTime();
    expect(localDayKey(timestamp)).toBe("2026-01-02");
  });
});
