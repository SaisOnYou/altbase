// The status console's text: a header with the farm's overall status, online and offline counts,
// then one line per account with what it is doing and where. Plain lines with ANSI colours, as a
// Windows console draws them. Pure (no i18n import), so scripts/test-console.mjs can run it.

/** What one account is doing, as the console says it. */
export type ConsoleState =
  | "inGame" // its client is in a game
  | "joining" // its client is starting or joining
  | "rejoining"
  | "down" // its client was disconnected
  | "signIn" // its sign-in needs renewing
  | "elsewhere" // in a game, not through Altbase (Roblox says so)
  | "studio"
  | "online"
  | "offline";

export type ConsoleRow = {
  name: string;
  state: ConsoleState;
  /** The game's name, when known. */
  game: string | null;
  upMs: number | null;
  ramMb: number | null;
};

export type ConsoleLabels = {
  title: string;
  status: string;
  online: string;
  offline: string;
  total: string;
  ram: string;
  cpu: string;
  account: string;
  state: string;
  game: string;
  up: string;
  states: Record<ConsoleState, string>;
  overall: { down: string; farming: string; starting: string; idle: string };
  counts: { inGame: string; joining: string; down: string };
  empty: string;
};

export type ConsoleInput = {
  rows: ConsoleRow[];
  /** The clock shown top-right, already formatted. */
  clock: string;
  ramMb: number | null;
  cpuPct: number | null;
  labels: ConsoleLabels;
};

const W = 80;
const esc = (code: string) => `\x1b[${code}m`;
const RESET = esc("0");
const C = { dim: "90", text: "97", soft: "37", cyan: "96", magenta: "95", green: "92", red: "91", yellow: "93", blue: "94" } as const;
const paint = (code: string, s: string) => `${esc(code)}${s}${RESET}`;

const STATE_COLOR: Record<ConsoleState, string> = {
  inGame: C.green,
  joining: C.cyan,
  rejoining: C.yellow,
  down: C.red,
  signIn: C.yellow,
  elsewhere: C.blue,
  studio: C.blue,
  online: C.soft,
  offline: C.dim,
};
/** A mark beside each state, so it reads without colour too; all in the classic console fonts
 * (Consolas, Lucida Console), so none shows as a box. */
const STATE_MARK: Record<ConsoleState, string> = {
  inGame: "●",
  joining: "►",
  rejoining: "»",
  down: "■",
  signIn: "♦",
  elsewhere: "●",
  studio: "▲",
  online: "○",
  offline: "·",
};

/** Whether the account counts as online (pure). */
export const isOnline = (s: ConsoleState) => s !== "offline" && s !== "signIn" && s !== "down";

/** `s` cut or padded to `n` characters (pure). */
export function fit(s: string, n: number): string {
  const chars = [...s];
  if (chars.length > n) return `${chars.slice(0, n - 1).join("")}…`;
  return s + " ".repeat(n - chars.length);
}
const right = (s: string, n: number) => " ".repeat(Math.max(0, n - [...s].length)) + s;

export function short(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
export const megabytes = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

const fill = (s: string, n: number) => s.replaceAll("{count}", String(n));

/** The console's whole text (pure). */
export function statusText({ rows, clock, ramMb, cpuPct, labels: L }: ConsoleInput): string {
  const n = (s: ConsoleState) => rows.filter((r) => r.state === s).length;
  const inGame = n("inGame");
  const joining = n("joining") + n("rejoining");
  const down = n("down");
  const online = rows.filter((r) => isOnline(r.state)).length;
  const rule = paint(C.dim, "─".repeat(W));

  const [overall, overallColor] = down
    ? [fill(L.overall.down, down), C.red]
    : inGame
      ? [L.overall.farming, C.green]
      : joining
        ? [L.overall.starting, C.cyan]
        : [L.overall.idle, C.dim];
  const counts = [inGame && fill(L.counts.inGame, inGame), joining && fill(L.counts.joining, joining), down && fill(L.counts.down, down)].filter(Boolean).join(" · ");

  const lines: string[] = [];
  const head = ` ${L.title}`;
  lines.push(`${esc("1;95")}${head}${RESET}${" ".repeat(Math.max(1, W - [...head].length - [...clock].length - 1))}${paint(C.dim, clock)}`);
  lines.push(rule);
  lines.push(`  ${paint(C.dim, fit(L.status, 9))}${esc(`1;${overallColor}`)}● ${overall}${RESET}${counts ? `   ${paint(C.soft, counts)}` : ""}`);
  const stat = (label: string, value: string, color: string) => `${paint(C.dim, label)} ${paint(`1;${color}`, value)}`;
  const parts = [stat(L.online, String(online), online ? C.green : C.dim), stat(L.offline, String(rows.length - online), C.text), stat(L.total, String(rows.length), C.text)];
  if (ramMb !== null) parts.push(stat(L.ram, megabytes(ramMb), C.cyan));
  if (cpuPct !== null) parts.push(stat(L.cpu, `${Math.round(cpuPct)}%`, C.cyan));
  lines.push(`  ${parts.join("    ")}`);
  lines.push(rule);

  // 2 + account 20 + state 16 + game 23 + up 7 + ram 8, a space between: 80 columns.
  lines.push(paint(C.dim, `  ${fit(L.account, 20)} ${fit(L.state, 16)} ${fit(L.game, 23)} ${right(L.up, 7)} ${right("RAM", 8)}`));
  for (const r of rows) {
    const color = STATE_COLOR[r.state];
    const state = `${STATE_MARK[r.state]} ${L.states[r.state]}`;
    const quiet = r.state === "offline";
    lines.push(
      `  ${paint(quiet ? C.dim : C.text, fit(r.name, 20))} ${paint(color, fit(state, 16))} ${paint(quiet ? C.dim : C.soft, fit(r.game ?? "—", 23))} ${paint(C.dim, right(r.upMs === null ? "" : short(r.upMs), 7))} ${paint(C.dim, right(r.ramMb === null ? "" : megabytes(r.ramMb), 8))}`,
    );
  }
  if (!rows.length) lines.push(`  ${paint(C.dim, L.empty)}`);
  lines.push(rule);
  return lines.join("\n");
}
