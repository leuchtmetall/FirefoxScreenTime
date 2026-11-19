import { allowedExtensions } from "./daily.ts";
import type { OverlayMode, StatusSnapshot } from "./types.ts";

/**
 * Block-everything mode covers every tab; block-tracked mode covers every tracked tab; otherwise
 * only tracked tabs past the daily limit are covered.
 *
 * Only imports modules the content script bundles anyway, since it bundles this one into every page.
 */
export function overlayMode(
  status: Pick<StatusSnapshot, "blockAll" | "blockTracked" | "blocked">,
  tracked: boolean,
): OverlayMode | undefined {
  if (status.blockAll) return "block-all";
  if (!tracked) return undefined;
  if (status.blockTracked) return "block-tracked";
  return status.blocked ? "limit" : undefined;
}

/**
 * Identifies what an overlay shows, so it is rebuilt exactly when its content would change. The
 * time-up view differs between regular and strict mode and by which extensions remain today.
 */
export function overlayViewKey(
  mode: OverlayMode | undefined,
  status: Pick<StatusSnapshot, "settings" | "usage">,
): string | undefined {
  if (mode !== "limit") return mode;
  const strict = status.settings.strictMode;
  const allowed = allowedExtensions(strict, status.usage);
  return `limit:${strict ? "strict" : "regular"}:${allowed.join(",")}`;
}

/**
 * Reload shortcuts (F5, Ctrl/Cmd+R, each optionally with Shift) keep their browser default while
 * the overlay swallows keys, since reloading cannot operate the covered page.
 */
export function isReloadShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): boolean {
  if (event.altKey) return false;
  if (event.key === "F5") return true;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r";
}
