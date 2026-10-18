> [!NOTE]
> AI usage disclosure: Most of this project is AI generated.

# Firefox Screen Time

A Firefox extension to limit screen time for selected urls, including tabs opened from these.

## Development

Install dependencies:

```bash
bun install
```

Build the extension:

```bash
bun run build
```

Watch source and public files:

```bash
bun run dev
```

Run checks:

```bash
bun run test
bun run typecheck
```

Launch a temporary Firefox profile with the extension:

```bash
bun run firefox
```

Alternatively, build with `bun run build`, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `dist/manifest.json`. After rebuilding, use **Reload** on that page.

## Behavior

- Time accumulates only for the active tracked tab while its Firefox window is focused.
- Configured hostnames include their subdomains and share one daily allowance.
- A new tab opened by a tracked tab inherits tracking, including across ordinary navigations.
- Typing a non-tracked URL into an inherited tab removes its inherited tracking.
- The popup's **Stop tracking this tab** button removes the current tab from tracking for the rest of its lifetime (including later navigations to tracked sites); **Track this tab again** undoes it.
- At the limit, an opaque overlay blocks interaction and visibility without replacing or unloading the document.
- The overlay can add 5 or 15 minutes, or disable blocking until local midnight.
- The popup's **Block everything** button covers every web page, tracked or not, with an overlay. In this mode the daily timer is paused and the regular-mode state (used time, extensions) is left untouched. **Back to regular mode** turns it off. The mode stays on across browser restarts until you turn it off.

## Permissions

- `storage`: stores configuration and daily usage.
- `alarms`: checkpoints active time every 15 seconds and detects day rollover.
- `webNavigation`: identifies committed and explicitly typed top-level navigations.
- `sessions`: stores inherited tracking on each tab without relying on reusable numeric tab IDs.
- `<all_urls>` host access: injects the visual blocker and evaluates child tabs, which may navigate to any HTTP or HTTPS URL. The extension does not inspect or modify subresource requests.
