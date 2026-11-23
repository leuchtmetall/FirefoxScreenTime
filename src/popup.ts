import { remainingMs } from "./shared/daily.ts";
import { isLimitMode, isStrict, modeLabel } from "./shared/modes.ts";
import type {
  ExtensionRequest,
  ExtensionResponse,
  LimitMode,
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
const resetSettings = requiredElement<HTMLButtonElement>("reset-settings");
const toggleTab = requiredElement<HTMLButtonElement>("toggle-tab");
const toggleBlockAll = requiredElement<HTMLButtonElement>("toggle-block-all");
const toggleBlockTracked = requiredElement<HTMLButtonElement>("toggle-block-tracked");
const resetToday = requiredElement<HTMLButtonElement>("reset-today");
const modeNote = requiredElement("mode-note");
const hostnamesLock = requiredElement("hostnames-lock");
const superstrictConfirm = requiredElement("superstrict-confirm");
const superstrictActivate = requiredElement<HTMLButtonElement>("superstrict-activate");
const superstrictCancel = requiredElement<HTMLButtonElement>("superstrict-cancel");
const MAX_DAILY_LIMIT_MINUTES = limitInput.max;
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

/** The mode the user last chose: a switch pending until tomorrow, or else the saved mode. */
function chosenMode(status: Pick<StatusSnapshot, "settings" | "pendingLimitMode">): LimitMode {
  return status.pendingLimitMode ?? status.settings.limitMode;
}

function populateForm(status: StatusSnapshot): void {
  const { settings } = status;
  limitInput.value = String(settings.dailyLimitMinutes);
  limitModeInput.value = chosenMode(status);
  hostnamesInput.value = settings.trackedHostnames.join("\n");
  showBadgeInput.checked = settings.showBadge;
  startDayPausedInput.checked = settings.startDayPaused;
  updateFormButtons();
}

function readForm(): Settings {
  return {
    dailyLimitMinutes: Number(limitInput.value),
    limitMode: isLimitMode(limitModeInput.value) ? limitModeInput.value : "regular",
    showBadge: showBadgeInput.checked,
    startDayPaused: startDayPausedInput.checked,
    trackedHostnames: hostnamesInput.value
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

/** Whether the form differs from the saved settings (taking a pending mode switch as the saved mode). */
function formChanged(status: StatusSnapshot): boolean {
  const form = readForm();
  const saved = status.settings;
  return (
    form.dailyLimitMinutes !== saved.dailyLimitMinutes ||
    form.limitMode !== chosenMode(status) ||
    form.showBadge !== saved.showBadge ||
    form.startDayPaused !== saved.startDayPaused ||
    form.trackedHostnames.join("\n") !== saved.trackedHostnames.join("\n")
  );
}

/** Saving and resetting are only possible when the form has changes and no save is under way. */
function updateFormButtons(): void {
  const changed = !saving && lastStatus !== undefined && formChanged(lastStatus);
  saveButton.disabled = !changed;
  resetSettings.hidden = !changed;
}

/**
 * Strict mode (as saved, not as edited) offers no way to undo today's usage, nor to stop tracking a
 * tab once time is up. Superstrict mode never lets a tab stop being tracked, and doesn't allow
 * raising the allowance. The background enforces all of these; the popup only mirrors them.
 */
function renderModeLocks(status: StatusSnapshot): void {
  const mode = status.settings.limitMode;
  const superstrict = mode === "superstrict";
  const strict = isStrict(mode);
  toggleTab.disabled =
    status.currentTabTracked && (superstrict || (mode === "strict" && status.blocked));
  toggleTab.title = !toggleTab.disabled
    ? ""
    : superstrict
      ? "Not available in superstrict mode"
      : "Not available in strict mode once time is up";
  resetToday.disabled = strict;
  resetToday.title = strict ? `Not available in ${modeLabel(mode).toLowerCase()} mode` : "";
  if (strict) disarmReset();
  limitInput.max = superstrict
    ? String(status.settings.dailyLimitMinutes)
    : MAX_DAILY_LIMIT_MINUTES;
  limitInput.title = superstrict ? "Superstrict mode doesn't allow raising the allowance" : "";
  hostnamesLock.hidden = !superstrict;
  modeNote.hidden = status.pendingLimitMode === undefined;
  modeNote.textContent =
    status.pendingLimitMode === undefined
      ? ""
      : `${modeLabel(mode)} mode stays on until midnight. ${modeLabel(status.pendingLimitMode)} mode starts tomorrow.`;
}

function render(status: StatusSnapshot): void {
  lastStatus = status;
  lastStatusAt = performance.now();
  renderTimer(status);
  renderTabState(status);
  renderBlockToggles(status);
  renderModeLocks(status);
  updateFormButtons();
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
    if (lastStatus) renderModeLocks(lastStatus);
  }
}

/** After an edit: refreshes the buttons, wiggling the save button when the edit just enabled it. */
function handleEdit(): void {
  superstrictConfirm.hidden = true;
  const wasDisabled = saveButton.disabled;
  updateFormButtons();
  if (wasDisabled && !saveButton.disabled) saveButton.classList.add("wiggle");
}

form.addEventListener("input", handleEdit);
form.addEventListener("change", handleEdit);
saveButton.addEventListener("animationend", () => saveButton.classList.remove("wiggle"));

async function saveForm(): Promise<void> {
  superstrictConfirm.hidden = true;
  feedback.textContent = "Saving...";
  saving = true;
  updateFormButtons();
  try {
    const requested = readForm();
    const status = handleResponse(await request({ type: "save-settings", settings: requested }));
    if (status) {
      populateForm(status);
      feedback.textContent =
        status.pendingLimitMode === requested.limitMode
          ? "Superstrict mode can't be turned off on the same day. Your change takes effect tomorrow."
          : "Saved";
    }
  } finally {
    saving = false;
    updateFormButtons();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (saveButton.disabled || !lastStatus) return;
  // Superstrict mode can't be undone today, so activating it asks for confirmation first.
  const activatesSuperstrict =
    readForm().limitMode === "superstrict" && lastStatus.settings.limitMode !== "superstrict";
  if (activatesSuperstrict) {
    feedback.textContent = "";
    superstrictConfirm.hidden = false;
    superstrictActivate.focus();
    return;
  }
  void saveForm();
});

superstrictActivate.addEventListener("click", () => void saveForm());
superstrictCancel.addEventListener("click", () => {
  superstrictConfirm.hidden = true;
  saveButton.focus();
});

resetSettings.addEventListener("click", () => {
  if (!lastStatus) return;
  superstrictConfirm.hidden = true;
  populateForm(lastStatus);
  feedback.textContent = "";
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
