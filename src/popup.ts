import { remainingMs } from "./shared/daily.ts";
import type {
  ExtensionRequest,
  ExtensionResponse,
  Settings,
  StatusSnapshot,
} from "./shared/types.ts";

const elapsed = requiredElement("elapsed");
const remaining = requiredElement("remaining");
const stateLabel = requiredElement("state-label");
const limitInput = requiredElement<HTMLInputElement>("daily-limit");
const limitModeInput = requiredElement<HTMLSelectElement>("limit-mode");
const showBadgeInput = requiredElement<HTMLInputElement>("show-badge");
const startDayPausedInput = requiredElement<HTMLInputElement>("start-day-paused");
const hostnamesInput = requiredElement<HTMLTextAreaElement>("hostnames");
const form = requiredElement<HTMLFormElement>("settings-form");
const feedback = requiredElement("feedback");
const saveButton = requiredElement<HTMLButtonElement>("save-settings");
const toggleTab = requiredElement<HTMLButtonElement>("toggle-tab");
const toggleBlockAll = requiredElement<HTMLButtonElement>("toggle-block-all");
const toggleBlockTracked = requiredElement<HTMLButtonElement>("toggle-block-tracked");
const resetToday = requiredElement<HTMLButtonElement>("reset-today");
let currentTabId: number | undefined;
/** The last snapshot from the background and when it arrived, for ticking the timer between polls. */
let lastStatus: StatusSnapshot | undefined;
let lastStatusAt = 0;
let saving = false;

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function remainingLabel(status: StatusSnapshot): string {
  if (status.blockAll) return "Blocking everything · paused";
  if (status.blockTracked) return "Blocking tracked sites · paused";
  if (status.usage.blockingDisabled) return "Open for today";
  return `${formatDuration(remainingMs(status))} left`;
}

function renderTimer(status: StatusSnapshot): void {
  elapsed.textContent = formatDuration(status.usage.elapsedMs);
  remaining.dataset["blockAll"] = String(status.blockAll || status.blockTracked);
  remaining.textContent = remainingLabel(status);
}

function tabStateLabel(status: StatusSnapshot): string {
  if (status.currentTabTracked) return "This tab is tracked";
  return status.currentTabExcluded
    ? "This tab was removed from tracking"
    : "This tab is not tracked";
}

function renderTabState(status: StatusSnapshot): void {
  stateLabel.textContent = tabStateLabel(status);
  stateLabel.dataset["tracked"] = String(status.currentTabTracked);
  toggleTab.hidden = currentTabId === undefined;
  toggleTab.textContent = toggleTabLabel(status);
}

function toggleTabLabel(status: StatusSnapshot): string {
  if (status.currentTabTracked) return "Stop tracking this tab";
  return status.currentTabExcluded ? "Track this tab again" : "Track this tab";
}

function renderBlockToggles(status: StatusSnapshot): void {
  toggleBlockAll.textContent = status.blockAll ? "Back to regular mode" : "Block everything";
  toggleBlockAll.dataset["active"] = String(status.blockAll);
  toggleBlockAll.setAttribute("aria-pressed", String(status.blockAll));
  const blockTrackedLabel = status.blockTracked ? "Unblock tracked sites" : "Block tracked sites";
  toggleBlockTracked.setAttribute("aria-label", blockTrackedLabel);
  toggleBlockTracked.title = blockTrackedLabel;
  toggleBlockTracked.dataset["active"] = String(status.blockTracked);
  toggleBlockTracked.setAttribute("aria-pressed", String(status.blockTracked));
}

function populateForm({ settings }: StatusSnapshot): void {
  limitInput.value = String(settings.dailyLimitMinutes);
  limitModeInput.value = settings.strictMode ? "strict" : "regular";
  hostnamesInput.value = settings.trackedHostnames.join("\n");
  showBadgeInput.checked = settings.showBadge;
  startDayPausedInput.checked = settings.startDayPaused;
  updateSaveButton();
}

function readForm(): Settings {
  return {
    dailyLimitMinutes: Number(limitInput.value),
    strictMode: limitModeInput.value === "strict",
    showBadge: showBadgeInput.checked,
    startDayPaused: startDayPausedInput.checked,
    trackedHostnames: hostnamesInput.value
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

/** Whether the form differs from the saved settings. */
function formChanged(saved: Settings): boolean {
  const form = readForm();
  return (
    form.dailyLimitMinutes !== saved.dailyLimitMinutes ||
    form.strictMode !== saved.strictMode ||
    form.showBadge !== saved.showBadge ||
    form.startDayPaused !== saved.startDayPaused ||
    form.trackedHostnames.join("\n") !== saved.trackedHostnames.join("\n")
  );
}

/** Saving is only possible when there is something to save and no save is under way. */
function updateSaveButton(): void {
  saveButton.disabled = saving || !lastStatus || !formChanged(lastStatus.settings);
}

function render(status: StatusSnapshot): void {
  lastStatus = status;
  lastStatusAt = performance.now();
  renderTimer(status);
  renderTabState(status);
  renderBlockToggles(status);
  updateSaveButton();
}

/**
 * The snapshot as it should read `sinceMs` later. The popup's tab is the active one, so time is
 * accruing exactly when that tab is tracked and nothing blocks it.
 */
function projectStatus(status: StatusSnapshot, sinceMs: number): StatusSnapshot {
  const accruing =
    status.currentTabTracked && !status.blocked && !status.blockAll && !status.blockTracked;
  if (!accruing) return status;
  const elapsedMs = status.usage.elapsedMs + sinceMs;
  return {
    ...status,
    usage: {
      ...status.usage,
      elapsedMs: status.usage.blockingDisabled
        ? elapsedMs
        : Math.min(elapsedMs, status.effectiveLimitMs),
    },
  };
}

/** Advances the displayed timer between polls, so it counts in seconds without extra messaging. */
function tick(): void {
  if (lastStatus) renderTimer(projectStatus(lastStatus, performance.now() - lastStatusAt));
}

async function request(message: ExtensionRequest): Promise<ExtensionResponse> {
  return browser.runtime.sendMessage(message) as Promise<ExtensionResponse>;
}

/** Applies a response: renders the new status, or shows the error. Returns the status on success. */
function handleResponse(response: ExtensionResponse): StatusSnapshot | undefined {
  if (!response.ok) {
    feedback.textContent = response.error;
    return undefined;
  }
  render(response.status);
  return response.status;
}

async function refresh(): Promise<StatusSnapshot | undefined> {
  return handleResponse(await request({ type: "get-status", tabId: currentTabId }));
}

/** Sends a button's request with the button disabled meanwhile, then shows the outcome. */
async function runAction(
  button: HTMLButtonElement,
  message: ExtensionRequest,
  successText?: string,
): Promise<void> {
  button.disabled = true;
  try {
    const status = handleResponse(await request(message));
    if (status && successText !== undefined) feedback.textContent = successText;
  } finally {
    button.disabled = false;
  }
}

form.addEventListener("input", updateSaveButton);
form.addEventListener("change", updateSaveButton);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  feedback.textContent = "Saving...";
  saving = true;
  updateSaveButton();
  try {
    const status = handleResponse(await request({ type: "save-settings", settings: readForm() }));
    if (status) {
      populateForm(status);
      feedback.textContent = "Saved";
    }
  } finally {
    saving = false;
    updateSaveButton();
  }
});

toggleTab.addEventListener("click", () => {
  if (currentTabId === undefined || !lastStatus) return;
  const { currentTabTracked, currentTabExcluded } = lastStatus;
  void runAction(
    toggleTab,
    currentTabTracked || currentTabExcluded
      ? { type: "set-tab-excluded", tabId: currentTabId, excluded: !currentTabExcluded }
      : { type: "track-tab", tabId: currentTabId },
  );
});

toggleBlockAll.addEventListener("click", () => {
  if (!lastStatus) return;
  void runAction(toggleBlockAll, {
    type: "set-block-all",
    enabled: !lastStatus.blockAll,
    tabId: currentTabId,
  });
});

toggleBlockTracked.addEventListener("click", () => {
  if (!lastStatus) return;
  void runAction(toggleBlockTracked, {
    type: "set-block-tracked",
    enabled: !lastStatus.blockTracked,
    tabId: currentTabId,
  });
});

// The first click arms the button; a second click within a few seconds resets today's usage.
let resetConfirmTimer: number | undefined;

function disarmReset(): void {
  window.clearTimeout(resetConfirmTimer);
  resetConfirmTimer = undefined;
  resetToday.textContent = "Reset today";
  delete resetToday.dataset["armed"];
}

resetToday.addEventListener("click", () => {
  if (resetConfirmTimer === undefined) {
    resetToday.textContent = "Click again to reset";
    resetToday.dataset["armed"] = "true";
    resetConfirmTimer = window.setTimeout(disarmReset, 4_000);
    return;
  }
  disarmReset();
  void runAction(
    resetToday,
    { type: "reset-today", tabId: currentTabId },
    "Today's timer was reset",
  );
});

async function start(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const status = await refresh();
  if (status) populateForm(status);
}

void start();
window.setInterval(() => void refresh(), 5_000);
window.setInterval(tick, 1_000);
