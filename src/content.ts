import * as styles from "./overlay-styles.ts";
import { MS_PER_MINUTE } from "./shared/constants.ts";
import { overlayMode } from "./shared/overlay.ts";
import type {
  ContentUpdate,
  ExtendDuration,
  ExtensionRequest,
  ExtensionResponse,
  OverlayMode,
  StatusSnapshot,
} from "./shared/types.ts";

let overlayHost: HTMLDivElement | undefined;
let overlayObserver: MutationObserver | undefined;
let shownMode: OverlayMode | undefined;

/** Input events swallowed while the overlay is up, so the covered page cannot be scrolled or operated. */
const BLOCKED_EVENTS = ["wheel", "touchmove", "keydown"] as const;
const PAGE_STILL_HERE = "The page is still here beneath this screen.";

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / MS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

interface OverlayView {
  root: HTMLElement;
  note: HTMLElement;
  extensions: { button: HTMLButtonElement; durationMinutes: ExtendDuration }[];
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: styles.Style,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  styles.applyStyle(element, style);
  element.append(...children);
  return element;
}

function createDialog(eyebrow: string, title: string, ...content: Node[]): HTMLElement {
  const heading = createElement("h1", styles.title, title);
  heading.id = "screen-time-title";
  const veil = createElement(
    "div",
    styles.veil,
    createElement(
      "main",
      styles.card,
      createElement("div", styles.eyebrow, eyebrow),
      heading,
      ...content,
    ),
  );
  veil.setAttribute("role", "dialog");
  veil.setAttribute("aria-modal", "true");
  veil.setAttribute("aria-labelledby", heading.id);
  return veil;
}

/** The view for both block modes, which can only be turned off from the toolbar popup. */
function buildPausedView(eyebrow: string, title: string, message: string): OverlayView {
  const note = createElement(
    "div",
    styles.note,
    "Turn this mode off from the Screen Time toolbar button.",
  );
  const root = createDialog(
    eyebrow,
    title,
    createElement("p", styles.message, `${message} ${PAGE_STILL_HERE}`),
    note,
  );
  return { root, note, extensions: [] };
}

function buildTimeUpView(status: StatusSnapshot): OverlayView {
  const extensions = (
    [
      ["Add 5 minutes", 5, styles.button],
      ["Add 15 minutes", 15, styles.button],
      ["Allow for today", "rest-of-day", styles.primaryButton],
    ] as const
  ).map(([label, durationMinutes, buttonStyles]) => {
    const button = document.createElement("button");
    button.textContent = label;
    styles.applyButtonStyle(button, buttonStyles);
    return { button, durationMinutes };
  });
  const note = createElement("div", styles.note, "Your allowance resets at local midnight.");
  const root = createDialog(
    "Daily pause",
    "Time is up.",
    createElement(
      "p",
      styles.message,
      "You have used ",
      createElement("span", styles.time, formatDuration(status.usage.elapsedMs)),
      ` of tracked time today. ${PAGE_STILL_HERE}`,
    ),
    createElement("div", styles.actions, ...extensions.map(({ button }) => button)),
    note,
  );
  return { root, note, extensions };
}

function buildView(mode: OverlayMode, status: StatusSnapshot): OverlayView {
  switch (mode) {
    case "block-all":
      return buildPausedView(
        "Block everything",
        "Everything is paused.",
        "All pages are blocked and your daily timer is on hold.",
      );
    case "block-tracked":
      return buildPausedView(
        "Tracked sites blocked",
        "This site is paused.",
        "Tracked sites are blocked regardless of your remaining time, and your daily timer is on hold.",
      );
    case "limit":
      return buildTimeUpView(status);
  }
}

function preventInteraction(event: Event): void {
  if (!overlayHost) return;
  const path = event.composedPath();
  if (path.includes(overlayHost)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function removeOverlay(): void {
  shownMode = undefined;
  overlayObserver?.disconnect();
  overlayObserver = undefined;
  overlayHost?.remove();
  overlayHost = undefined;
  for (const type of BLOCKED_EVENTS) window.removeEventListener(type, preventInteraction, true);
}

/** Makes the time-up buttons request more time, removing the overlay once the tab is no longer blocked. */
function wireExtensionButtons(view: OverlayView): void {
  const setButtonsDisabled = (disabled: boolean): void => {
    for (const { button } of view.extensions) button.disabled = disabled;
  };
  for (const { button, durationMinutes } of view.extensions) {
    button.addEventListener("click", async () => {
      setButtonsDisabled(true);
      try {
        const response = (await browser.runtime.sendMessage({
          type: "extend",
          durationMinutes,
        } satisfies ExtensionRequest)) as ExtensionResponse;
        if (response.ok && overlayMode(response.status, true) === undefined) removeOverlay();
        else if (!response.ok) view.note.textContent = response.error;
      } catch {
        view.note.textContent = "Could not extend the allowance. Please try again.";
      } finally {
        if (overlayHost?.isConnected) setButtonsDisabled(false);
      }
    });
  }
}

function showOverlay(status: StatusSnapshot, mode: OverlayMode): void {
  if (overlayHost?.isConnected && shownMode === mode) return;
  removeOverlay();
  shownMode = mode;
  const host = document.createElement("div");
  host.setAttribute("data-firefox-screen-time", "blocked");
  styles.applyStyle(host, styles.host);
  const view = buildView(mode, status);
  host.attachShadow({ mode: "closed" }).append(view.root);
  wireExtensionButtons(view);
  overlayHost = host;

  const attach = (): void => document.documentElement.append(host);
  attach();
  // Put the same overlay back if the page removes it.
  overlayObserver = new MutationObserver(() => {
    if (!host.isConnected) attach();
  });
  overlayObserver.observe(document.documentElement, { childList: true });

  for (const type of BLOCKED_EVENTS) {
    window.addEventListener(type, preventInteraction, { capture: true, passive: false });
  }
}

/**
 * Removes overlay hosts left behind by a previous instance of this content script. Firefox gives
 * content scripts no reliable unload hook: when the extension is reloaded or disabled, the old
 * script's context is torn down but the DOM nodes it inserted stay in the page.
 */
function removeStaleOverlays(): void {
  for (const host of document.querySelectorAll("[data-firefox-screen-time]")) {
    if (host !== overlayHost) host.remove();
  }
}

function applyUpdate(mode: OverlayMode | undefined, status: StatusSnapshot): void {
  if (mode) showOverlay(status, mode);
  else removeOverlay();
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const update = message as Partial<ContentUpdate>;
  if (update.type === "tracking-update" && update.status) {
    applyUpdate(update.mode, update.status);
  }
});

void browser.runtime
  .sendMessage({ type: "get-status" } satisfies ExtensionRequest)
  .then((response: ExtensionResponse) => {
    if (response.ok)
      applyUpdate(overlayMode(response.status, response.status.currentTabTracked), response.status);
  })
  .catch(() => undefined)
  // Clean up after applying the current state so a still-blocked page never flashes uncovered.
  .finally(removeStaleOverlays);
