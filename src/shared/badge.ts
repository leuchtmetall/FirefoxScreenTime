import type { StatusSnapshot } from "./types.ts";

/** Toolbar badge text: remaining whole minutes (rounded up), or a marker for special states. */
export function badgeText(
  status: Pick<StatusSnapshot, "settings" | "usage" | "elapsedMs" | "effectiveLimitMs" | "blockAll">,
): string {
  if (!status.settings.showBadge || status.blockAll) return "";
  if (status.usage.blockingDisabled) return "∞";
  const minutes = Math.max(0, Math.ceil((status.effectiveLimitMs - status.elapsedMs) / 60_000));
  return minutes > 60 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes)}m`;
}
