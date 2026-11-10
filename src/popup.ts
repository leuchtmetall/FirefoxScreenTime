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
const showBadgeInput = requiredElement<HTMLInputElement>("show-badge");
const startDayPausedInput = requiredElement<HTMLInputElement>("start-day-paused");
const hostnamesInput = requiredElement<HTMLTextAreaElement>("hostnames");
const form = requiredElement<HTMLFormElement>("settings-form");
const feedback = requiredElement("feedback");
const toggleTab = requiredElement<HTMLButtonElement>("toggle-tab");
const toggleBlockAll = requiredElement<HTMLButtonElement>("toggle-block-all");
const toggleBlockTracked = requiredElement<HTMLButtonElement>("toggle-block-tracked");
const resetToday = requiredElement<HTMLButtonElement>("reset-today");
let blockAll = false;
let blockTracked = false;
let currentTabId: number | undefined;
let currentTabExcluded = false;

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

function render(status: StatusSnapshot, populateForm = false): void {
  elapsed.textContent = formatDuration(status.elapsedMs);
  remaining.dataset.blockAll = String(status.blockAll || status.blockTracked);
  remaining.textContent = status.blockAll
    ? "Blocking everything · paused"
    : status.blockTracked
      ? "Blocking tracked sites · paused"
      : status.usage.blockingDisabled
        ? "Open for today"
        : `${formatDuration(remainingMs(status))} left`;
  stateLabel.textContent = status.currentTabTracked
    ? "This tab is tracked"
    : status.currentTabExcluded
      ? "This tab was removed from tracking"
      : "This tab is not tracked";
  stateLabel.dataset.tracked = String(status.currentTabTracked);
  currentTabExcluded = status.currentTabExcluded;
  toggleTab.hidden =
    currentTabId === undefined || (!status.currentTabTracked && !status.currentTabExcluded);
  toggleTab.textContent = status.currentTabExcluded
    ? "Track this tab again"
    : "Stop tracking this tab";
  blockAll = status.blockAll;
  toggleBlockAll.textContent = status.blockAll ? "Back to regular mode" : "Block everything";
  toggleBlockAll.dataset.active = String(status.blockAll);
  toggleBlockAll.setAttribute("aria-pressed", String(status.blockAll));
  blockTracked = status.blockTracked;
  const blockTrackedLabel = status.blockTracked ? "Unblock tracked sites" : "Block tracked sites";
  toggleBlockTracked.setAttribute("aria-label", blockTrackedLabel);
  toggleBlockTracked.title = blockTrackedLabel;
  toggleBlockTracked.dataset.active = String(status.blockTracked);
  toggleBlockTracked.setAttribute("aria-pressed", String(status.blockTracked));
  if (populateForm) {
    limitInput.value = String(status.settings.dailyLimitMinutes);
    hostnamesInput.value = status.settings.trackedHostnames.join("\n");
    showBadgeInput.checked = status.settings.showBadge;
    startDayPausedInput.checked = status.settings.startDayPaused;
  }
}

async function request(message: ExtensionRequest): Promise<ExtensionResponse> {
  return browser.runtime.sendMessage(message) as Promise<ExtensionResponse>;
}

async function refresh(populateForm = false): Promise<void> {
  const response = await request({ type: "get-status", tabId: currentTabId });
  if (response.ok) render(response.status, populateForm);
  else feedback.textContent = response.error;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback.textContent = "Saving...";
  const settings: Settings = {
    dailyLimitMinutes: Number(limitInput.value),
    showBadge: showBadgeInput.checked,
    startDayPaused: startDayPausedInput.checked,
    trackedHostnames: hostnamesInput.value
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  };
  const response = await request({ type: "save-settings", settings });
  if (response.ok) {
    render(response.status, true);
    feedback.textContent = "Saved";
  } else {
    feedback.textContent = response.error;
  }
});

toggleTab.addEventListener("click", async () => {
  if (currentTabId === undefined) return;
  toggleTab.disabled = true;
  try {
    const response = await request({
      type: "set-tab-excluded",
      tabId: currentTabId,
      excluded: !currentTabExcluded,
    });
    if (response.ok) render(response.status);
    else feedback.textContent = response.error;
  } finally {
    toggleTab.disabled = false;
  }
});

toggleBlockAll.addEventListener("click", async () => {
  toggleBlockAll.disabled = true;
  try {
    const response = await request({
      type: "set-block-all",
      enabled: !blockAll,
      tabId: currentTabId,
    });
    if (response.ok) render(response.status);
    else feedback.textContent = response.error;
  } finally {
    toggleBlockAll.disabled = false;
  }
});

toggleBlockTracked.addEventListener("click", async () => {
  toggleBlockTracked.disabled = true;
  try {
    const response = await request({
      type: "set-block-tracked",
      enabled: !blockTracked,
      tabId: currentTabId,
    });
    if (response.ok) render(response.status);
    else feedback.textContent = response.error;
  } finally {
    toggleBlockTracked.disabled = false;
  }
});

// The first click arms the button; a second click within a few seconds resets today's usage.
let resetConfirmTimer: number | undefined;

function disarmReset(): void {
  window.clearTimeout(resetConfirmTimer);
  resetConfirmTimer = undefined;
  resetToday.textContent = "Reset today";
  delete resetToday.dataset.armed;
}

resetToday.addEventListener("click", async () => {
  if (resetConfirmTimer === undefined) {
    resetToday.textContent = "Click again to reset";
    resetToday.dataset.armed = "true";
    resetConfirmTimer = window.setTimeout(disarmReset, 4_000);
    return;
  }
  disarmReset();
  resetToday.disabled = true;
  try {
    const response = await request({ type: "reset-today", tabId: currentTabId });
    if (response.ok) {
      render(response.status);
      feedback.textContent = "Today's timer was reset";
    } else {
      feedback.textContent = response.error;
    }
  } finally {
    resetToday.disabled = false;
  }
});

async function start(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  await refresh(true);
}

void start();
window.setInterval(() => void refresh(false), 5_000);
