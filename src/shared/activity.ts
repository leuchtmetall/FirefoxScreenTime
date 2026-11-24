/** Seconds without user input after which the user counts as away, unless a shown tracked tab plays sound. */
export const IDLE_THRESHOLD_SECONDS = 5 * 60;

/** The active tab of a browser window that is not minimized, whether or not that window has focus. */
export interface ShownTab {
  id: number;
  /** Whether the tab plays sound the user can hear (audible and not muted). */
  audible: boolean;
}

interface WindowInfo {
  id?: number | undefined;
  state?: string | undefined;
}

interface ActiveTabInfo {
  id?: number | undefined;
  windowId?: number | undefined;
  audible?: boolean | undefined;
  mutedInfo?: { muted: boolean } | undefined;
}

/**
 * The tabs that are shown: the active tab of every window that is not minimized. A window counts even
 * when it lacks focus or is hidden behind other windows.
 */
export function shownTabs(windows: WindowInfo[], activeTabs: ActiveTabInfo[]): ShownTab[] {
  const shownWindowIds = new Set(
    windows.filter((window) => window.state !== "minimized").map((window) => window.id),
  );
  const shown: ShownTab[] = [];
  for (const tab of activeTabs) {
    if (tab.id === undefined || tab.windowId === undefined) continue;
    if (!shownWindowIds.has(tab.windowId)) continue;
    shown.push({ id: tab.id, audible: tab.audible === true && tab.mutedInfo?.muted !== true });
  }
  return shown;
}

/**
 * Whether tracked time runs: a shown tab is tracked, and the user is present or that tab plays sound
 * (e.g. a video watched without touching the computer).
 */
export function isTrackedTabInUse(
  shown: ShownTab[],
  isTracked: (tabId: number) => boolean,
  userIdle: boolean,
): boolean {
  return shown.some((tab) => isTracked(tab.id) && (!userIdle || tab.audible));
}
