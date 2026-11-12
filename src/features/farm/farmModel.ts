// The Farm view's model: every account as one row of the board, what the whole farm is doing, and
// what happened lately. Pure functions, so the view stays a picture of them.
import type { AccountSummary, ClientMetrics, Crash, CrashKind, GameServer, Instance } from "../../api";
import type { Tone } from "../../ui/Status";

/** What one account is doing, as the board shows it. */
export type Phase = "inGame" | "joining" | "starting" | "rejoining" | "down" | "idle" | "signIn";

export type Row = {
  account: AccountSummary;
  /** Its client, while one runs (or is down and not yet replaced). */
  inst: Instance | null;
  metric: ClientMetrics | null;
  phase: Phase;
};

export const PHASE_TONE: Record<Phase, Tone> = {
  inGame: "ok",
  joining: "info",
  starting: "info",
  rejoining: "warn",
  down: "err",
  idle: "neutral",
  signIn: "attention",
};

/** Board order: what needs you first, then what's working, then what's resting; an account that
 * only needs signing in (no client) comes last. */
const RANK: Record<Phase, number> = { down: 0, signIn: 1, rejoining: 2, starting: 3, joining: 4, inGame: 5, idle: 6 };
const rank = (r: Pick<Row, "phase" | "inst">) => (r.phase === "signIn" && !r.inst ? 7 : RANK[r.phase]);

export function phaseOf(a: AccountSummary, i: Instance | null): Phase {
  if (i) {
    if (i.relaunching) return "rejoining";
    if (i.state === "disconnected") return i.signInProblem ? "signIn" : "down";
    if (i.state === "inGame") return "inGame";
    if (i.state === "joining") return "joining";
    if (i.state === "starting") return "starting";
  }
  return a.status === "valid" ? "idle" : "signIn";
}

/** Each account with its newest client still running (pure). */
export function buildRows(accounts: AccountSummary[], instances: Instance[], metrics: ClientMetrics[]): Row[] {
  const byAccount = new Map<number, Instance>();
  for (const i of instances) {
    if (i.state === "exited") continue;
    const had = byAccount.get(i.accountId);
    if (!had || had.startedAt < i.startedAt) byAccount.set(i.accountId, i);
  }
  const byInst = new Map(metrics.map((m) => [m.instanceId, m]));
  return accounts
    .map((account) => {
      const inst = byAccount.get(account.id) ?? null;
      return { account, inst, metric: inst ? (byInst.get(inst.id) ?? null) : null, phase: phaseOf(account, inst) };
    })
    .sort((x, y) => rank(x) - rank(y) || Number(y.account.main) - Number(x.account.main) || x.account.sortOrder - y.account.sortOrder);
}

export type Filter = "all" | "live" | "down" | "idle";
export const FILTERS: Filter[] = ["all", "live", "down", "idle"];

export function inFilter(r: Row, f: Filter): boolean {
  if (f === "live") return r.phase === "inGame" || r.phase === "joining" || r.phase === "starting";
  if (f === "down") return r.phase === "down" || r.phase === "rejoining" || (r.phase === "signIn" && !!r.inst);
  if (f === "idle") return r.phase === "idle" || (r.phase === "signIn" && !r.inst);
  return true;
}

export type Stats = {
  total: number;
  ready: number;
  inGame: number;
  joining: number;
  down: number;
  idle: number;
  ramMb: number;
  /** Clients with a memory reading (for the average). */
  measured: number;
  rejoins: number;
  /** Unix ms the longest-running client started; null when none runs. */
  since: number | null;
  /** The game most clients are in, by place id. */
  topPlace: number | null;
};

export function farmStats(rows: Row[]): Stats {
  const s: Stats = { total: rows.length, ready: 0, inGame: 0, joining: 0, down: 0, idle: 0, ramMb: 0, measured: 0, rejoins: 0, since: null, topPlace: null };
  const places = new Map<number, number>();
  for (const r of rows) {
    if (r.account.status === "valid") s.ready++;
    if (r.phase === "inGame") s.inGame++;
    else if (r.phase === "joining" || r.phase === "starting") s.joining++;
    else if (r.phase === "down" || r.phase === "rejoining" || (r.phase === "signIn" && r.inst)) s.down++;
    else if (r.phase === "idle") s.idle++;
    if (r.metric) {
      s.ramMb += r.metric.memoryMb;
      s.measured++;
    }
    if (r.inst) {
      s.rejoins += r.inst.rejoins;
      if (s.since === null || r.inst.startedAt < s.since) s.since = r.inst.startedAt;
      if (r.inst.state === "inGame" && r.inst.placeId !== null) places.set(r.inst.placeId, (places.get(r.inst.placeId) ?? 0) + 1);
    }
  }
  let best = 0;
  for (const [place, n] of places) if (n > best) [best, s.topPlace] = [n, place];
  return s;
}

/** One line of the activity feed. */
export type FeedItem = { id: string; at: number; accountId: number; kind: CrashKind | "launched" | "rejoined"; reason: string | null; uptimeMs: number | null };

export const FEED_TONE: Record<FeedItem["kind"], Tone> = {
  launched: "info",
  rejoined: "ok",
  crash: "err",
  disconnect: "err",
  hang: "attention",
  mem: "warn",
  scheduled: "neutral",
};

/** What happened lately, newest first (pure): clients that started, and every crash, disconnect,
 * hang and restart the backend kept. */
export function feedOf(instances: Instance[], crashes: Crash[], limit = 60): FeedItem[] {
  const out: FeedItem[] = crashes.map((c) => ({ id: `c${c.id}`, at: c.at, accountId: c.accountId, kind: c.kind, reason: c.reason, uptimeMs: c.uptimeMs }));
  for (const i of instances) out.push({ id: `i${i.id}`, at: i.startedAt, accountId: i.accountId, kind: i.rejoins > 0 ? "rejoined" : "launched", reason: null, uptimeMs: null });
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** A server for `n` clients to go to together (pure): the one with the most room that isn't any
 * they're in now; it must fit them all when one does. Null: none has room. */
export function pickTogether(servers: GameServer[], n: number, current: ReadonlySet<string>): GameServer | null {
  const open = servers.filter((sv) => !current.has(sv.id) && sv.playing < sv.maxPlayers);
  if (!open.length) return null;
  const room = (sv: GameServer) => sv.maxPlayers - sv.playing;
  const fits = open.filter((sv) => room(sv) >= n);
  // Of the ones that fit, the fullest (players to farm with); else the emptiest.
  if (fits.length) return fits.sort((a, b) => b.playing - a.playing)[0];
  return open.sort((a, b) => room(b) - room(a))[0];
}

/** "2h 05m" / "14m" / "40s": short, for a dense column (pure). */
export function short(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
