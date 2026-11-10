import { useSyncExternalStore } from "react";

// This PC's reading and seeing choices (Settings › Accessibility), kept in localStorage so they
// survive a restart and apply before the vault is open. Each one is an attribute or a property on
// <html> that CSS reads (styles/a11y.css):
// - textSize: the whole interface scaled (the web view's own zoom in the app, CSS zoom elsewhere).
// - contrast "more": darker text, stronger borders (html[data-contrast="more"]).
// - boldFocus: a thicker keyboard focus ring (html[data-focus="bold"]).
// - readableFont: Atkinson Hyperlegible for the interface (html[data-font="readable"]).
// - navLabels: every tab in the island wears its name, not only the current one.
// - underlineLinks: links and link-like buttons are underlined (html[data-links="underline"]).
export type Prefs = {
  textSize: number;
  contrast: "normal" | "more";
  boldFocus: boolean;
  readableFont: boolean;
  navLabels: boolean;
  underlineLinks: boolean;
};

export const TEXT_SIZES = [90, 100, 110, 125, 150] as const;
const DEFAULTS: Prefs = { textSize: 100, contrast: "normal", boldFocus: false, readableFont: false, navLabels: true, underlineLinks: false };
const KEY = "altbase.prefs";

const subs = new Set<() => void>();
let prefs: Prefs = DEFAULTS;
let installed = false;

/** What storage held, with anything unknown or out of range put back to its default (pure). */
export function parsePrefs(stored: string | null): Prefs {
  let raw: Partial<Record<keyof Prefs, unknown>> = {};
  try {
    const v: unknown = stored ? JSON.parse(stored) : null;
    if (v && typeof v === "object") raw = v as typeof raw;
  } catch {
    // Not JSON: the defaults.
  }
  const bool = (k: "boldFocus" | "readableFont" | "navLabels" | "underlineLinks") => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : DEFAULTS[k]);
  return {
    textSize: (TEXT_SIZES as readonly number[]).includes(raw.textSize as number) ? (raw.textSize as number) : DEFAULTS.textSize,
    contrast: raw.contrast === "more" ? "more" : "normal",
    boldFocus: bool("boldFocus"),
    readableFont: bool("readableFont"),
    navLabels: bool("navLabels"),
    underlineLinks: bool("underlineLinks"),
  };
}

/** The web view's own zoom when Altbase runs as the app; CSS zoom in a browser preview, or if the
 * app refuses. */
async function zoom(pct: number) {
  const root = document.documentElement;
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(pct / 100);
      root.style.removeProperty("zoom");
      return;
    } catch {
      // Falls through to CSS zoom.
    }
  }
  if (pct === 100) root.style.removeProperty("zoom");
  else root.style.setProperty("zoom", String(pct / 100));
}

function apply() {
  const root = document.documentElement;
  const set = (name: string, value: string | null) => (value === null ? root.removeAttribute(name) : root.setAttribute(name, value));
  set("data-contrast", prefs.contrast === "more" ? "more" : null);
  set("data-focus", prefs.boldFocus ? "bold" : null);
  set("data-font", prefs.readableFont ? "readable" : null);
  set("data-links", prefs.underlineLinks ? "underline" : null);
  void zoom(prefs.textSize);
  subs.forEach((f) => f());
}

/** Reads the stored choices and applies them; called once before the first paint (main.tsx). */
export function installPrefs() {
  if (installed) return;
  installed = true;
  try {
    prefs = parsePrefs(localStorage.getItem(KEY));
  } catch {
    // No storage: the defaults.
  }
  apply();
}

/** Changes some choices; kept on this PC only. */
export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not kept: it applies until Altbase restarts.
  }
  apply();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** This PC's choices, kept current. */
export function usePrefs() {
  return useSyncExternalStore(subscribe, () => prefs, () => DEFAULTS);
}
