import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AccountSummary } from "../../api";
import { useFavourites, useInstances } from "../../data";
import { t } from "../../i18n";
import { toast } from "../../ui/Toast";
import { launchOne, launchSame, sessionFps } from "./launchQueue";
import { draftFor } from "./target";

// Play at start (Settings > Launching): one favourite launched by itself a few seconds after
// Altbase opens with the vault unlocked. With Start with Windows, a PC that restarts overnight
// is farming again without anyone at it. This PC's choice, kept in localStorage; once per run of
// the app (sessionStorage), so a reload of the window never launches twice.
const KEY = "altbase.startFavourite";
const RAN = "altbase.startPlayed";
/** Long enough to read the toast and close Altbase, or lock it, if this wasn't wanted. */
const DELAY_MS = 8000;

const subs = new Set<() => void>();
const read = (): number | null => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

/** The favourite to play at start; null: none. */
export function setStartFavourite(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(id));
  } catch {
    // Not kept.
  }
  subs.forEach((f) => f());
}

export function useStartFavourite() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    read,
    () => null,
  );
}

/** The accounts of a favourite that can launch now (pure): signed in and not already playing, in
 * the favourite's own order. */
export function readyFor(accountIds: number[], accounts: AccountSummary[], live: Set<number>): AccountSummary[] {
  return accountIds.flatMap((id) => accounts.find((a) => a.id === id && a.status === "valid" && !live.has(id)) ?? []);
}

/** Runs Play at start once the accounts, favourites and running clients are known. */
export function useStartPlay(accounts: AccountSummary[] | undefined) {
  const favs = useFavourites().data;
  const instances = useInstances().data;
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !accounts || !favs || !instances) return;
    done.current = true;
    const id = read();
    if (id === null) return;
    try {
      if (sessionStorage.getItem(RAN)) return;
      sessionStorage.setItem(RAN, "1");
    } catch {
      return;
    }
    const f = favs.find((x) => x.id === id);
    if (!f) return;
    const ready = readyFor(f.accountIds, accounts, new Set(instances.filter((i) => i.state !== "exited").map((i) => i.accountId)));
    if (!ready.length) return;
    toast(t("launch.startPlay.soon", { name: f.name }));
    // Not cleared on unmount: the shell unmounts only when the vault locks, and then the launch
    // is refused (locked) with nothing started.
    window.setTimeout(() => {
      const where = { draft: draftFor(f.target, f.id, f.name), setDraft: () => {} };
      void (ready.length === 1 ? launchOne(ready[0], where, sessionFps()) : launchSame(ready, where, { fpsCap: sessionFps() }));
    }, DELAY_MS);
  }, [accounts, favs, instances]);
}
