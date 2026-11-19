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
