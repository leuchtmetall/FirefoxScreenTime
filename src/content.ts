import type {
  ContentUpdate,
  ExtensionRequest,
  ExtensionResponse,
  StatusSnapshot,
} from "./shared/types.ts";

let overlayHost: HTMLDivElement | undefined;
let overlayObserver: MutationObserver | undefined;
let blockedStatus: StatusSnapshot | undefined;

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
  overlayObserver?.disconnect();
  overlayObserver = undefined;
  overlayHost?.remove();
  overlayHost = undefined;
  window.removeEventListener("wheel", preventInteraction, true);
  window.removeEventListener("touchmove", preventInteraction, true);
  window.removeEventListener("keydown", preventInteraction, true);
}

function showOverlay(status: StatusSnapshot): void {
  blockedStatus = status;
  if (overlayHost?.isConnected) return;
  overlayObserver?.disconnect();
  overlayObserver = undefined;
  overlayHost = undefined;
  const host = document.createElement("div");
  host.setAttribute("data-firefox-screen-time", "blocked");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.setProperty("visibility", "visible", "important");
  host.style.setProperty("opacity", "1", "important");
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .veil {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        padding: 24px;
        background: #17231f;
        color: #f7f1df;
        font-family: ui-rounded, "Avenir Next", Avenir, system-ui, sans-serif;
      }
      .card { width: min(540px, 100%); text-align: center; }
      .eyebrow { color: #f09a72; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: 14px 0 10px; font-family: Georgia, serif; font-size: clamp(34px, 7vw, 58px); font-weight: 400; line-height: 1; }
      p { margin: 0 auto 30px; max-width: 430px; color: #c9d0c5; font-size: 16px; line-height: 1.55; }
      .time { color: #fff; font-weight: 750; }
      .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
      button {
        border: 1px solid #52625a;
        border-radius: 999px;
        padding: 11px 18px;
        background: transparent;
        color: #f7f1df;
        font: 700 14px ui-rounded, "Avenir Next", Avenir, system-ui, sans-serif;
        cursor: pointer;
      }
      button:hover, button:focus-visible { border-color: #f09a72; background: #26362f; outline: none; }
      button.primary { border-color: #e16a3d; background: #d85832; }
      button.primary:hover, button.primary:focus-visible { background: #ec7045; }
      .note { margin-top: 24px; color: #7f9087; font-size: 12px; }
    </style>
    <div class="veil" role="dialog" aria-modal="true" aria-labelledby="screen-time-title">
      <main class="card">
        <div class="eyebrow">Daily pause</div>
        <h1 id="screen-time-title">Time is up.</h1>
        <p>You have used <span class="time" data-elapsed></span> of tracked time today. The page is still here beneath this screen.</p>
        <div class="actions">
          <button data-duration="5">Add 5 minutes</button>
          <button data-duration="15">Add 15 minutes</button>
          <button class="primary" data-duration="rest-of-day">Allow for today</button>
        </div>
        <div class="note" data-note>Your allowance resets at local midnight.</div>
      </main>
    </div>
  `;
  const elapsed = shadow.querySelector<HTMLElement>("[data-elapsed]");
  if (elapsed) elapsed.textContent = formatDuration(status.elapsedMs);
  overlayHost = host;
  (document.documentElement ?? document).append(host);

  overlayObserver = new MutationObserver(() => {
    if (blockedStatus && !overlayHost?.isConnected) showOverlay(blockedStatus);
  });
  overlayObserver.observe(document.documentElement, { childList: true });

  window.addEventListener("wheel", preventInteraction, { capture: true, passive: false });
  window.addEventListener("touchmove", preventInteraction, { capture: true, passive: false });
  window.addEventListener("keydown", preventInteraction, true);

  shadow.querySelectorAll<HTMLButtonElement>("button[data-duration]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.duration;
      const durationMinutes = value === "rest-of-day" ? value : value === "5" ? 5 : 15;
      shadow.querySelectorAll<HTMLButtonElement>("button").forEach((candidate) => {
        candidate.disabled = true;
      });
      try {
        const response = await browser.runtime.sendMessage({
          type: "extend",
          durationMinutes,
        } satisfies ExtensionRequest) as ExtensionResponse;
        if (response.ok && !response.status.blocked) removeOverlay();
        else if (!response.ok) {
          const note = shadow.querySelector<HTMLElement>("[data-note]");
          if (note) note.textContent = response.error;
        }
      } catch {
        const note = shadow.querySelector<HTMLElement>("[data-note]");
        if (note) note.textContent = "Could not extend the allowance. Please try again.";
      } finally {
        if (overlayHost?.isConnected) {
          shadow.querySelectorAll<HTMLButtonElement>("button").forEach((candidate) => {
            candidate.disabled = false;
          });
        }
      }
    });
  });
}

function applyUpdate(blocked: boolean, status: StatusSnapshot): void {
  if (blocked) showOverlay(status);
  else removeOverlay();
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const update = message as Partial<ContentUpdate>;
  if (update.type === "tracking-update" && typeof update.blocked === "boolean" && update.status) {
    applyUpdate(update.blocked, update.status);
  }
});

void browser.runtime.sendMessage({ type: "get-status" } satisfies ExtensionRequest)
  .then((response: ExtensionResponse) => {
    if (response.ok) applyUpdate(response.status.blocked && response.status.currentTabTracked, response.status);
  })
  .catch(() => undefined);
