import { useEffect, useState } from "react";
import { api } from "../../api";
import { setSplashPhase, type SplashPhase } from "./phase";
import "./splash.css";

/** When the window grows: the mark settles at about 1.1 s, then holds a beat. */
const GROW_MS = 1100 + 500;
/** Set once the splash has run: a webview reload doesn't play it again. */
const KEY = "altbase.splash";

function seen() {
  // A dev preview with ?splash=1 plays it again.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("splash")) return false;
  // Settings.skip_splash, from `main_window`: the window is already full size.
  if ((window as { __ALTBASE_SKIP_SPLASH?: boolean }).__ALTBASE_SKIP_SPLASH) return true;
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

// Decided before anything renders, so the island knows to wait for it.
const FIRST: SplashPhase = seen() ? "gone" : "play";
setSplashPhase(FIRST);

/** The start-up splash over the app: the ring glides in beside the clay disc (two of you, side by
 * side), the name settles beneath, then the window
 * (opened small by `splash::start`) grows into the app and this fades away. */
export function Splash() {
  const [state, setState] = useState<SplashPhase>(FIRST);

  useEffect(() => setSplashPhase(state), [state]);

  useEffect(() => {
    if (state !== "play") return;
    // Plays even with Windows' animation effects off (theme.css leaves the splash out).
    const grow = () => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        // No storage: a reload plays it again.
      }
      // Fades once the window has grown, even if growing failed.
      api.splashDone().finally(() => setState("out"));
    };
    const t = setTimeout(grow, GROW_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (state === "gone") return null;
  return (
    <div
      className={`splash ${state === "out" ? "out" : ""}`}
      data-tauri-drag-region
      onTransitionEnd={(e) => e.target === e.currentTarget && setState("gone")}
      aria-hidden="true"
    >
      <svg className="splash-mark" width="96" height="96" viewBox="0 0 18 18" aria-hidden="true" data-tauri-drag-region>
        <circle className="splash-disc" cx="6.6" cy="9" r="5.1" />
        <circle className="splash-ring" cx="11.6" cy="9" r="4.4" />
      </svg>
      <div className="splash-word" data-tauri-drag-region>Altbase</div>
    </div>
  );
}
