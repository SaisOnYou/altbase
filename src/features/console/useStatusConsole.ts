import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, events, type AccountSummary, type Presence } from "../../api";
import { qk, queryClient, usePresence } from "../../data";
import { t } from "../../i18n";
import { useStreamer } from "../../ui/streamer";
import { accountName } from "../accounts/shared";
import { buildRows, type Phase } from "../farm/farmModel";
import { statusText, type ConsoleLabels, type ConsoleRow, type ConsoleState } from "./statusText";

// The status console (src-tauri/src/console.rs): a console window beside Altbase that shows which
// accounts are online, what they're playing and what's down. This side writes its text: on every
// console://tick from Rust (which arrives even while Altbase is minimized), and every 2 s as well.

const START_KEY = "altbase.consoleAtStart";
const subs = new Set<() => void>();

function readStart(): boolean {
  try {
    return localStorage.getItem(START_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the console opens when Altbase does (this PC only). */
export function setConsoleAtStart(on: boolean) {
  try {
    if (on) localStorage.setItem(START_KEY, "1");
    else localStorage.removeItem(START_KEY);
  } catch {
    // Not kept.
  }
  subs.forEach((f) => f());
}
export const useConsoleAtStart = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    readStart,
    () => false,
  );

/** Whether the console is open; asked again every few seconds, since closing its window closes it. */
export const useConsoleOpen = () => useQuery({ queryKey: qk.console, queryFn: api.consoleIsOpen, refetchInterval: 4000 }).data === true;

/** Opens or closes the console. */
export async function setConsole(open: boolean) {
  const now = open ? await api.consoleOpen() : await api.consoleClose();
  queryClient.setQueryData(qk.console, now);
  return now;
}

const PHASE_STATE: Record<Exclude<Phase, "idle">, ConsoleState> = {
  inGame: "inGame",
  joining: "joining",
  starting: "joining",
  rejoining: "rejoining",
  down: "down",
  signIn: "signIn",
};

/** An account without a client of Altbase's, by what Roblox says about it. */
function fromPresence(p: Presence | undefined): ConsoleState {
  if (p?.kind === "inGame") return "elsewhere";
  if (p?.kind === "studio") return "studio";
  if (p?.kind === "online") return "online";
  return "offline";
}

function labels(): ConsoleLabels {
  return {
    title: t("console.title"),
    status: t("console.status"),
    online: t("console.online"),
    offline: t("console.offline"),
    total: t("console.total"),
    ram: t("console.ram"),
    cpu: t("console.cpu"),
    account: t("console.account"),
    state: t("console.state"),
    game: t("console.game"),
    up: t("console.up"),
    states: {
      inGame: t("farm.phase.inGame"),
      joining: t("farm.phase.joining"),
      rejoining: t("farm.phase.rejoining"),
      down: t("farm.phase.down"),
      signIn: t("farm.phase.signIn"),
      elsewhere: t("console.state.elsewhere"),
      studio: t("console.state.studio"),
      online: t("console.state.online"),
      offline: t("console.state.offline"),
    },
    overall: { down: t("console.overall.down"), farming: t("console.overall.farming"), starting: t("console.overall.starting"), idle: t("console.overall.idle") },
    counts: { inGame: t("console.count.inGame"), joining: t("console.count.joining"), down: t("console.count.down") },
    empty: t("console.empty"),
  };
}

/** Game names already looked up; places that failed aren't asked again. */
const failed = new Set<number>();
async function gameName(placeId: number): Promise<string | null> {
  if (failed.has(placeId)) return null;
  try {
    const g = await queryClient.fetchQuery({ queryKey: qk.game(placeId), queryFn: () => api.gameInfo(placeId), staleTime: 30 * 60_000 });
    return g.name;
  } catch {
    failed.add(placeId);
    return null;
  }
}

/** Keeps the console's text current while it is open, and opens it at start when asked to. */
export function useStatusConsole(accounts: AccountSummary[] | undefined) {
  const open = useConsoleOpen();
  const presence = usePresence(open && accounts ? accounts.map((a) => a.id) : []).data;
  const streamer = useStreamer();
  const latest = useRef({ accounts, presence, streamer });
  latest.current = { accounts, presence, streamer };

  useEffect(() => {
    if (readStart()) void setConsole(true).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    let busy = false;
    const draw = async () => {
      if (busy) return;
      busy = true;
      try {
        const [instances, metrics, system] = await Promise.all([api.instancesList(), api.instancesMetrics(), api.systemUsage().catch(() => null)]);
        const { accounts, presence, streamer } = latest.current;
        if (!accounts) return;
        const now = Date.now();
        const byPresence = presence as Map<number, Presence> | undefined;
        const rows: ConsoleRow[] = [];
        let ramMb = 0;
        let measured = 0;
        for (const [n, r] of buildRows(accounts, instances, metrics).entries()) {
          const p = byPresence?.get(r.account.id);
          const state = r.phase === "idle" ? fromPresence(p) : PHASE_STATE[r.phase];
          const place = r.inst?.placeId ?? null;
          const game = place !== null ? await gameName(place) : state === "elsewhere" || state === "studio" ? (p?.lastLocation ?? null) : null;
          if (r.metric) {
            ramMb += r.metric.memoryMb;
            measured++;
          }
          rows.push({
            name: streamer ? r.account.alias || `#${n + 1}` : accountName(r.account),
            state,
            game,
            upMs: r.inst ? now - r.inst.startedAt : null,
            ramMb: r.metric?.memoryMb ?? null,
          });
        }
        // Those Roblox shows offline go last.
        rows.sort((a, b) => Number(a.state === "offline") - Number(b.state === "offline"));
        const text = statusText({ rows, clock: new Date().toLocaleTimeString(), ramMb: measured ? ramMb : null, cpuPct: system?.cpuPct ?? null, labels: labels() });
        await api.consoleWrite(text);
      } catch {
        // The next tick tries again.
      } finally {
        busy = false;
      }
    };
    void draw();
    const timer = window.setInterval(() => void draw(), 2000);
    const unlisten = events.onConsoleTick(() => void draw());
    return () => {
      window.clearInterval(timer);
      void unlisten.then((f) => f());
    };
  }, [open]);
}

