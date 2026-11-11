import type { OverlayMode, StatusSnapshot } from "./types.ts";

/**
 * Block-everything mode covers every tab; block-tracked mode covers every tracked tab; otherwise
 * only tracked tabs past the daily limit are covered.
 *
 * Kept free of other imports: the content script bundles this module into every page.
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
