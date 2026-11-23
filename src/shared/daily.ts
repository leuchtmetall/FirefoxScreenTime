import { MS_PER_MINUTE } from "./constants.ts";
import type { DailyUsage, ExtendDuration } from "./types.ts";

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function freshDailyUsage(now: number): DailyUsage {
  return {
    dayKey: localDayKey(now),
    elapsedMs: 0,
    extraMs: 0,
    blockingDisabled: false,
  };
}

export function rollUsageToNow(usage: DailyUsage, now: number): DailyUsage {
  return usage.dayKey === localDayKey(now) ? usage : freshDailyUsage(now);
}

export function addActiveInterval(usage: DailyUsage, startedAt: number, now: number): DailyUsage {
  const current = rollUsageToNow(usage, now);
  const intervalStart = Math.max(startedAt, startOfLocalDay(now));
  return {
    ...current,
    elapsedMs: current.elapsedMs + Math.max(0, now - intervalStart),
  };
}

export function effectiveLimitMs(usage: DailyUsage, dailyLimitMinutes: number): number {
  return dailyLimitMinutes * MS_PER_MINUTE + usage.extraMs;
}

/**
 * The extensions that may be granted once the limit is reached. Strict modes allow a single
 * 5-minute extension per day; any extra time already granted today counts as that extension.
 */
export function allowedExtensions(
  strict: boolean,
  usage: Pick<DailyUsage, "extraMs">,
): ExtendDuration[] {
  if (!strict) return [5, 15, "rest-of-day"];
  return usage.extraMs > 0 ? [] : [5];
}

type Allowance = { effectiveLimitMs: number; usage: Pick<DailyUsage, "elapsedMs"> };

export function remainingMs(status: Allowance): number {
  return Math.max(0, status.effectiveLimitMs - status.usage.elapsedMs);
}

/** Remaining time in whole minutes, rounded up so the last partial minute still shows as 1. */
export function remainingMinutes(status: Allowance): number {
  return Math.ceil(remainingMs(status) / MS_PER_MINUTE);
}

export function isDailyBlocked(usage: DailyUsage, dailyLimitMinutes: number): boolean {
  return !usage.blockingDisabled && usage.elapsedMs >= effectiveLimitMs(usage, dailyLimitMinutes);
}
