import type { DailyUsage } from "./types.ts";

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
  return dailyLimitMinutes * 60_000 + usage.extraMs;
}

export function isDailyBlocked(usage: DailyUsage, dailyLimitMinutes: number): boolean {
  return !usage.blockingDisabled && usage.elapsedMs >= effectiveLimitMs(usage, dailyLimitMinutes);
}
