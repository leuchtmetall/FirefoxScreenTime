import * as styles from "./overlay-styles.ts";
import { applyButtonStyle, applyStyle, type Style } from "./overlay-styles.ts";
import { overlayMode } from "./shared/tracking.ts";
import type {
  ContentUpdate,
  ExtensionRequest,
  ExtensionResponse,
  OverlayMode,
  StatusSnapshot,
} from "./shared/types.ts";

let overlayHost: HTMLDivElement | undefined;
let overlayObserver: MutationObserver | undefined;
let blockedStatus: StatusSnapshot | undefined;
let shownMode: OverlayMode | undefined;

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

type ExtendDuration = Extract<ExtensionRequest, { type: "extend" }>["durationMinutes"];

interface OverlayView {
  root: HTMLElement;
  note: HTMLElement;
  extensions: { button: HTMLButtonElement; durationMinutes: ExtendDuration }[];
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Style,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  applyStyle(element, style);
  element.append(...children);
  return element;
}

function createDialog(eyebrow: string, title: string, ...content: Node[]): HTMLElement {
  const heading = createElement("h1", styles.title, title);
  heading.id = "screen-time-title";
  const veil = createElement(
    "div",
    styles.veil,
    createElement("main", styles.card, createElement("div", styles.eyebrow, eyebrow), heading, ...content),
  );
  veil.setAttribute("role", "dialog");
  veil.setAttribute("aria-modal", "true");
  veil.setAttribute("aria-labelledby", heading.id);
  return veil;
}

function buildBlockAllView(): OverlayView {
  const note = createElement("div", styles.note, "Turn this mode off from the Screen Time toolbar button.");
  const root = createDialog(
    "Block everything",
    "Everything is paused.",
    createElement(
      "p",
      styles.message,
      "All pages are blocked and your daily timer is on hold. The page is still here beneath this screen.",
    ),
    note,
  );
  return { root, note, extensions: [] };
}

function buildTimeUpView(status: StatusSnapshot): OverlayView {
  const extensions = ([
    ["Add 5 minutes", 5, styles.button],
    ["Add 15 minutes", 15, styles.button],
    ["Allow for today", "rest-of-day", styles.primaryButton],
  ] as const).map(([label, durationMinutes, buttonStyles]) => {
    const button = document.createElement("button");
    button.textContent = label;
    applyButtonStyle(button, buttonStyles);
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
      createElement("span", styles.time, formatDuration(status.elapsedMs)),
      " of tracked time today. The page is still here beneath this screen.",
    ),
    createElement("div", styles.actions, ...extensions.map(({ button }) => button)),
    note,
  );
  return { root, note, extensions };
}

function preventInteraction(event: Event): void {
  if (!overlayHost) return;
  const path = event.composedPath();
  if (path.includes(overlayHost)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function removeOverlay(): void {
  blockedStatus = undefined;
  shownMode = undefined;
  overlayObserver?.disconnect();
  overlayObserver = undefined;
  overlayHost?.remove();
  overlayHost = undefined;
  window.removeEventListener("wheel", preventInteraction, true);
  window.removeEventListener("touchmove", preventInteraction, true);
  window.removeEventListener("keydown", preventInteraction, true);
}

function showOverlay(status: StatusSnapshot, mode: OverlayMode): void {
  if (overlayHost?.isConnected && shownMode === mode) {
    blockedStatus = status;
    return;
  }
  if (overlayHost?.isConnected) removeOverlay();
  blockedStatus = status;
  shownMode = mode;
  overlayObserver?.disconnect();
  overlayObserver = undefined;
  overlayHost = undefined;
  const host = document.createElement("div");
  host.setAttribute("data-firefox-screen-time", "blocked");
  applyStyle(host, styles.host);
  const shadow = host.attachShadow({ mode: "closed" });
  const view = mode === "block-all" ? buildBlockAllView() : buildTimeUpView(status);
  shadow.append(view.root);
  overlayHost = host;
  (document.documentElement ?? document).append(host);

  overlayObserver = new MutationObserver(() => {
    if (blockedStatus && shownMode && !overlayHost?.isConnected) showOverlay(blockedStatus, shownMode);
  });
  overlayObserver.observe(document.documentElement, { childList: true });

  window.addEventListener("wheel", preventInteraction, { capture: true, passive: false });
  window.addEventListener("touchmove", preventInteraction, { capture: true, passive: false });
  window.addEventListener("keydown", preventInteraction, true);

  const setButtonsDisabled = (disabled: boolean): void => {
    for (const { button } of view.extensions) button.disabled = disabled;
  };
  for (const { button, durationMinutes } of view.extensions) {
    button.addEventListener("click", async () => {
      setButtonsDisabled(true);
      try {
        const response = await browser.runtime.sendMessage({
          type: "extend",
          durationMinutes,
        } satisfies ExtensionRequest) as ExtensionResponse;
        if (response.ok && !response.status.blocked && !response.status.blockAll) removeOverlay();
        else if (!response.ok) view.note.textContent = response.error;
      } catch {
        view.note.textContent = "Could not extend the allowance. Please try again.";
      } finally {
        if (overlayHost?.isConnected) setButtonsDisabled(false);
      }
    });
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

void browser.runtime.sendMessage({ type: "get-status" } satisfies ExtensionRequest)
  .then((response: ExtensionResponse) => {
    if (response.ok) applyUpdate(overlayMode(response.status, response.status.currentTabTracked), response.status);
  })
  .catch(() => undefined)
  // Clean up after applying the current state so a still-blocked page never flashes uncovered.
  .finally(removeStaleOverlays);
