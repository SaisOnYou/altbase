import { useSyncExternalStore } from "react";
import { api } from "../api";

/** The spoken greeting at start (`say_greeting`, Windows' own voice): this PC's choice, on unless
 * turned off in Settings, Appearance. Said once per start, never again on a window reload. */
const KEY = "altbase.greeting";
const SAID = "altbase.greetingSaid";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let on = read();
const subscribers = new Set<() => void>();
const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => void subscribers.delete(f);
};

export const useGreeting = () => useSyncExternalStore(subscribe, () => on);

export function setGreeting(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // Storage unavailable: this session only.
  }
  subscribers.forEach((f) => f());
}

/** Says it now (Settings' Preview). Never throws: a quiet PC is fine. */
export function sayGreeting() {
  api.sayGreeting().catch(() => {});
}

/** At start: once per session, while it is on. */
export function greetOnce() {
  if (!on) return;
  try {
    if (sessionStorage.getItem(SAID)) return;
    sessionStorage.setItem(SAID, "1");
  } catch {
    // No storage: a reload may say it again.
  }
  sayGreeting();
}
