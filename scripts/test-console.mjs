import assert from "node:assert/strict";
import { fit, isOnline, statusText } from "../src/features/console/statusText.ts";

// The status console's text: every line fits an 80-column console, and the header adds up.
const labels = {
  title: "ALTBASE · LIVE STATUS",
  status: "STATUS",
  online: "ONLINE",
  offline: "OFFLINE",
  total: "TOTAL",
  ram: "RAM",
  cpu: "CPU",
  account: "ACCOUNT",
  state: "STATE",
  game: "GAME",
  up: "UP",
  states: { inGame: "In game", joining: "Joining", rejoining: "Rejoining", down: "Down", signIn: "Sign in needed", elsewhere: "Playing", studio: "In Studio", online: "Online", offline: "Offline" },
  overall: { down: "{count} DOWN", farming: "FARMING", starting: "STARTING", idle: "NOT FARMING" },
  counts: { inGame: "{count} in game", joining: "{count} joining", down: "{count} down" },
  empty: "No accounts yet.",
};
const rows = [
  { name: "Alt 07", state: "down", game: "Sky Islands", upMs: 3.8 * 3600e3, ramMb: 662 },
  { name: "Alt 02", state: "inGame", game: "Sky Islands", upMs: 3 * 3600e3, ramMb: 742 },
  { name: "A very long account display name", state: "inGame", game: "A game with an extremely long name indeed", upMs: 59e3, ramMb: 1530 },
  { name: "Alt 09", state: "joining", game: null, upMs: 12e3, ramMb: null },
  { name: "Main", state: "elsewhere", game: "Pet Simulator 99", upMs: null, ramMb: null },
  { name: "Trader", state: "signIn", game: null, upMs: null, ramMb: null },
  { name: "Builder", state: "offline", game: null, upMs: null, ramMb: null },
];
const text = statusText({ rows, clock: "20:46:12", ramMb: 2934, cpuPct: 23.4, labels });
const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
if (process.argv.includes("--show")) console.log(text);
for (const line of plain.split("\n")) assert.ok([...line].length <= 80, `fits 80 columns: "${line}" is ${[...line].length}`);
assert.match(plain, /● 1 DOWN/, "a down client makes the overall status DOWN");
assert.match(plain, /2 in game · 1 joining · 1 down/);
assert.match(plain, /ONLINE 4 {4}OFFLINE 3 {4}TOTAL 7/, "online: in game, joining and playing elsewhere");
assert.match(plain, /RAM 2\.9 GB/);
assert.ok(isOnline("elsewhere") && !isOnline("offline") && !isOnline("down"));
assert.equal(fit("abcdef", 4), "abc…");
assert.equal(fit("ab", 4), "ab  ");
const idle = statusText({ rows: [], clock: "x", ramMb: null, cpuPct: null, labels }).replace(/\x1b\[[0-9;]*m/g, "");
assert.match(idle, /NOT FARMING/);
assert.match(idle, /No accounts yet\./);
console.log("console text: ok");
