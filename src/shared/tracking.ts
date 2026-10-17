import type { TabTrackingState } from "./types.ts";
import { isTrackedUrl } from "./urls.ts";

export function transitionTabState(
  previous: TabTrackingState | undefined,
  url: string | undefined,
  hostnames: string[],
  typedNavigation: boolean,
): TabTrackingState {
  const direct = isTrackedUrl(url, hostnames);
  const inherited = typedNavigation && !direct ? false : (previous?.inherited ?? false);
  const excluded = previous?.excluded ?? false;
  return { inherited, excluded, tracked: !excluded && (direct || inherited), url };
}

/** Manually excludes a tab from tracking (or re-includes it), keeping it excluded across navigations. */
export function setTabExcluded(
  previous: TabTrackingState | undefined,
  url: string | undefined,
  hostnames: string[],
  excluded: boolean,
): TabTrackingState {
  return transitionTabState({ inherited: previous?.inherited ?? false, tracked: false, excluded }, url, hostnames, false);
}
