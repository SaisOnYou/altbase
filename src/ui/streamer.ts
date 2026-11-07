import { useSyncExternalStore } from "react";
import type { AccountSummary } from "../api";

/** Streamer mode: this PC's choice (not a Settings field), off by default. While on, account names
 * become "Account 1, 2, …" before anything shows them (`useAccounts`), user ids and cookies are
 * hidden (`.sensitive`, styles/warm.css; DetailCookie), and the user's own aliases stay: they are
 * the names to show on stream. */
const KEY = "altbase.streamer";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

let on = read();
const apply = () => {
  if (on) document.documentElement.dataset.streamer = "";
  else delete document.documentElement.dataset.streamer;
};
apply();
const subscribers = new Set<() => void>();
const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => void subscribers.delete(f);
};

export const useStreamer = () => useSyncExternalStore(subscribe, () => on);
export const streamerOn = () => on;

export function setStreamer(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // Storage unavailable: this session only.
  }
  apply();
  subscribers.forEach((f) => f());
}

/** The accounts as streamer mode shows them: names by position, aliases kept (pure). */
export function masked(list: AccountSummary[]): AccountSummary[] {
  return list.map((a, i) => {
    const name = `Account ${i + 1}`;
    return { ...a, username: name, displayName: name };
  });
}
