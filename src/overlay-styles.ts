/**
 * Inline styles for the timeout overlay.
 *
 * Styles are applied through the CSSOM (`element.style.setProperty`) rather than a `<style>`
 * element or `style="..."` attributes, because pages with a strict Content-Security-Policy
 * (`style-src` without `'unsafe-inline'`) block the latter two, even inside a shadow root.
 */

import { colors } from "./shared/colors.ts";

export type Style = Readonly<Record<string, string>>;

const fontStack = `ui-rounded, "Avenir Next", Avenir, system-ui, sans-serif`;

export const host: Style = {
  all: "initial",
  display: "block",
  position: "fixed",
  inset: "0",
  "z-index": "2147483647",
  visibility: "visible",
  opacity: "1",
};

export const veil: Style = {
  position: "fixed",
  inset: "0",
  "z-index": "2147483647",
  display: "grid",
  "place-items": "center",
  "box-sizing": "border-box",
  padding: "24px",
  background: colors.background,
  color: colors.text,
  "font-family": fontStack,
};

export const card: Style = {
  display: "block",
  width: "min(540px, 100%)",
  "text-align": "center",
};

export const eyebrow: Style = {
  color: colors.accent,
  "font-size": "12px",
  "font-weight": "800",
  "letter-spacing": ".16em",
  "text-transform": "uppercase",
};

export const title: Style = {
  margin: "14px 0 10px",
  "font-family": "Georgia, serif",
  "font-size": "clamp(34px, 7vw, 58px)",
  "font-weight": "400",
  "line-height": "1",
};

export const message: Style = {
  margin: "0 auto 30px",
  "max-width": "430px",
  color: colors.muted,
  "font-size": "16px",
  "line-height": "1.55",
};

export const time: Style = {
  color: "#fff",
  "font-weight": "750",
};

export const actions: Style = {
  display: "flex",
  "flex-wrap": "wrap",
  "justify-content": "center",
  gap: "10px",
};

export const note: Style = {
  "margin-top": "24px",
  color: colors.faint,
  "font-size": "12px",
};

export interface ButtonStyles {
  readonly base: Style;
  /** Applied on top of `base` while hovered or keyboard-focused. */
  readonly active: Style;
}

export const button: ButtonStyles = {
  base: {
    border: `1px solid ${colors.border}`,
    "border-radius": "999px",
    padding: "11px 18px",
    background: "transparent",
    color: colors.text,
    font: `700 14px ${fontStack}`,
    cursor: "pointer",
    outline: "none",
  },
  active: {
    "border-color": colors.accent,
    background: colors.hoverBackground,
  },
};

export const primaryButton: ButtonStyles = {
  base: {
    ...button.base,
    "border-color": colors.primaryBorder,
    background: colors.primary,
  },
  active: {
    background: colors.primaryHover,
  },
};

export function applyStyle(element: HTMLElement, style: Style): void {
  for (const [property, value] of Object.entries(style)) {
    element.style.setProperty(property, value, "important");
  }
}

/** Applies button styles, switching to the active variant on hover and keyboard focus. */
export function applyButtonStyle(element: HTMLButtonElement, styles: ButtonStyles): void {
  const activeStyle = { ...styles.base, ...styles.active };
  let wasActive = false;
  const refresh = (): void => {
    const active = element.matches(":hover") || element.matches(":focus-visible");
    if (active === wasActive) return;
    wasActive = active;
    applyStyle(element, active ? activeStyle : styles.base);
  };
  for (const event of ["pointerenter", "pointerleave", "focus", "blur"]) {
    element.addEventListener(event, refresh);
  }
  applyStyle(element, styles.base);
}
