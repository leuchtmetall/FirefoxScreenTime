import { remainingMs } from "./daily.ts";
import type { StatusSnapshot } from "./types.ts";

/** Toolbar badge text: remaining whole minutes (rounded up), or a marker for special states. */
export function badgeText(
  status: Pick<
    StatusSnapshot,
    "settings" | "usage" | "elapsedMs" | "effectiveLimitMs" | "blockAll" | "blockTracked"
  >,
): string {
  if (!status.settings.showBadge || status.blockAll || status.blockTracked) return "";
  if (status.usage.blockingDisabled) return "∞";
  const minutes = Math.ceil(remainingMs(status) / 60_000);
  return minutes > 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}
