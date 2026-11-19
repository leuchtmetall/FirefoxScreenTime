/**
 * Holds a blocked page's title still. Firefox puts a dot on a background tab whose title changes
 * (tabbrowser's `DOMTitleChanged` handler), and extensions have no API to clear it, so every title
 * change a blocked page makes is undone.
 *
 * Gecko reads the new title in a task it queues after the change, while MutationObserver callbacks
 * run as microtasks, so the revert lands first and Firefox finds the tab's label unchanged.
 */

let observer: MutationObserver | undefined;
/** The `<head>` being observed, re-targeted if the page replaces it. */
let observedHead: HTMLHeadElement | null = null;
/** The title held while frozen. */
let frozenTitle = "";
/** The latest title the page set while frozen, applied when the freeze ends. */
let pageTitle: string | undefined;

function observeTitle(titleObserver: MutationObserver): void {
  titleObserver.disconnect();
  // `document.title` reads the first `<title>`, which the setter creates inside `<head>`.
  titleObserver.observe(document.documentElement, { childList: true });
  observedHead = document.head;
  if (observedHead) {
    titleObserver.observe(observedHead, { childList: true, subtree: true, characterData: true });
  }
}

function enforceTitle(): void {
  if (!observer) return;
  if (document.head !== observedHead) observeTitle(observer);
  const title = document.title;
  // Firefox shows no dot for a tab that is still loading, so let the page settle on its title first.
  if (document.readyState !== "complete") {
    frozenTitle = title;
    return;
  }
  if (title === frozenTitle) return;
  pageTitle = title;
  document.title = frozenTitle;
}

/** Starts holding the current title. Does nothing if the title is already frozen. */
export function freezeTitle(): void {
  if (observer) return;
  frozenTitle = document.title;
  pageTitle = undefined;
  observer = new MutationObserver(enforceTitle);
  observeTitle(observer);
}

/** Stops holding the title and shows the latest one the page set meanwhile. */
export function unfreezeTitle(): void {
  if (!observer) return;
  observer.disconnect();
  observer = undefined;
  observedHead = null;
  // A title still differing from the frozen one is a change the observer has not undone yet.
  if (pageTitle !== undefined && document.title === frozenTitle) document.title = pageTitle;
  pageTitle = undefined;
}
