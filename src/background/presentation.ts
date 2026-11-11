import { badgeText } from "../shared/badge.ts";
import { colors } from "../shared/colors.ts";
import { remainingMinutes } from "../shared/daily.ts";
import { overlayMode } from "../shared/overlay.ts";
import type {
  ContentUpdate,
  OverlayMode,
  StatusSnapshot,
  TabTrackingState,
} from "../shared/types.ts";

/** What each tab last displayed, so refreshes only call the browser APIs for values that changed. */
interface TabPresentation {
  icon: string;
  title: string;
  badgeColor: string;
  mode: OverlayMode | undefined;
}

const presented = new Map<number, TabPresentation>();
let presentedBadgeText: string | undefined;

const ignore = (): undefined => undefined;

function tabTitle(state: TabTrackingState | undefined, status: StatusSnapshot): string {
  if (status.blockAll) return "Screen Time: blocking everything";
  if (state?.tracked) {
    if (status.blockTracked) return "Screen Time: tracked sites blocked";
    return status.blocked
      ? "Screen Time: daily limit reached"
      : `Screen Time: tracked, ${remainingMinutes(status)} min remaining`;
  }
  return state?.excluded ? "Screen Time: removed from tracking" : "Screen Time: not tracked";
}

function badgeColor(tracked: boolean, status: StatusSnapshot): string {
  if (!tracked) return colors.neutral;
  return status.blocked ? colors.background : colors.primary;
}

export async function initializePresentation(): Promise<void> {
  await browser.action.setBadgeTextColor({ color: "#ffffff" }).catch(ignore);
}

async function presentBadgeText(status: StatusSnapshot): Promise<void> {
  const text = badgeText(status);
  if (text === presentedBadgeText) return;
  presentedBadgeText = text;
  await browser.action.setBadgeText({ text }).catch(ignore);
}

/** Brings a tab's toolbar button and page overlay in line with `status`, which must describe that tab. */
export async function presentTab(
  tabId: number,
  state: TabTrackingState | undefined,
  status: StatusSnapshot,
): Promise<void> {
  const tracked = state?.tracked === true;
  const next: TabPresentation = {
    icon: tracked || status.blockAll ? "icons/active.svg" : "icons/inactive.svg",
    title: tabTitle(state, status),
    badgeColor: badgeColor(tracked, status),
    mode: overlayMode(status, tracked),
  };
  const previous = presented.get(tabId);
  presented.set(tabId, next);

  const updates: Promise<unknown>[] = [presentBadgeText(status)];
  if (next.icon !== previous?.icon)
    updates.push(browser.action.setIcon({ tabId, path: next.icon }));
  if (next.title !== previous?.title)
    updates.push(browser.action.setTitle({ tabId, title: next.title }));
  if (next.badgeColor !== previous?.badgeColor) {
    updates.push(browser.action.setBadgeBackgroundColor({ tabId, color: next.badgeColor }));
  }
  if (!previous || next.mode !== previous.mode) {
    const update: ContentUpdate = { type: "tracking-update", mode: next.mode, status };
    updates.push(browser.tabs.sendMessage(tabId, update));
  }
  await Promise.all(updates.map((update) => update.catch(ignore)));
}

/** Forgets what a tab displays: it closed, Firefox reset its toolbar values, or it loaded a new document. */
export function forgetPresentation(tabId: number): void {
  presented.delete(tabId);
}
