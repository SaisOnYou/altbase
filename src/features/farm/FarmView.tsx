import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import "./farm.css";
import { api, type AccountSummary, type Favourite, type Instance, type LaunchTarget } from "../../api";
import {
  publicBlock,
  qk,
  useBulk,
  useCrashes,
  useFavourites,
  useGroups,
  useInstances,
  useMetrics,
  useMultiStatus,
  useNetwork,
  usePresence,
  useSettings,
  useSystemUsage,
} from "../../data";
import { fmtNum, t, type Key } from "../../i18n";
import { Chip } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Select } from "../../ui/Field";
import { Icon, type IconName } from "../../ui/Icon";
import { StatusPill, TONE_COLOR, TONE_SHAPE, type Tone } from "../../ui/Status";
import { toast, toastError } from "../../ui/Toast";
import { accountName, Avatar } from "../accounts/shared";
import { KillAllButton } from "../../app/KillAll";
import { requestNavigation } from "../../app/navigation";
import { pickHop } from "../dashboard/ClientMenu";
import { launchBlocked, launchEach, launchOne, launchSame, sessionFps, useLaunchStep } from "../launch/launchQueue";
import { useNow } from "../launch/Running";
import { mb } from "../monitor/MonitorView";
import { buildRows, farmStats, feedOf, FEED_TONE, FILTERS, inFilter, PHASE_TONE, pickTogether, short, type FeedItem, type Filter, type Phase, type Row } from "./farmModel";

const TARGET_KEY = "altbase.farmTarget";

function storedTarget(): string {
  try {
    return localStorage.getItem(TARGET_KEY) ?? "";
  } catch {
    return "";
  }
}

const PHASE_LABEL: Record<Phase, Key> = {
  inGame: "farm.phase.inGame",
  joining: "farm.phase.joining",
  starting: "farm.phase.starting",
  rejoining: "farm.phase.rejoining",
  down: "farm.phase.down",
  idle: "farm.phase.idle",
  signIn: "farm.phase.signIn",
};
const FILTER_LABEL: Record<Filter, Key> = { all: "farm.filter.all", live: "farm.filter.live", down: "farm.filter.down", idle: "farm.filter.idle" };
const FEED_LABEL: Record<FeedItem["kind"], Key> = {
  launched: "farm.feed.launched",
  rejoined: "farm.feed.rejoined",
  crash: "farm.feed.crash",
  disconnect: "farm.feed.disconnect",
  hang: "farm.feed.hang",
  mem: "farm.feed.mem",
  scheduled: "farm.feed.scheduled",
};

/** A game's name once Roblox has said it (cached for every view), else its place id. */
function GameName({ placeId }: { placeId: number }) {
  const g = useQuery({ queryKey: qk.game(placeId), queryFn: () => api.gameInfo(placeId), staleTime: 30 * 60_000 }).data;
  return <>{g?.name ?? t("farm.place", { id: placeId })}</>;
}

/** One HUD number: a label, the figure, and what it means. `meter`: 0..100 fills a bar. */
function Stat({ icon, label, value, of, sub, tone, meter, onClick }: {
  icon: IconName;
  label: string;
  value: string;
  of?: string;
  sub?: string;
  tone?: Tone;
  meter?: number | null;
  onClick?: () => void;
}) {
  const lit = tone && tone !== "neutral";
  return (
    <button type="button" className="farm-stat" data-tone={tone} onClick={onClick} style={lit ? { ["--stat" as string]: TONE_COLOR[tone] } : undefined}>
      <span className="farm-stat-label">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span className="farm-stat-value">
        {value}
        {of && <span className="farm-stat-of">{of}</span>}
      </span>
      {meter !== undefined && meter !== null ? (
        <span className="farm-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(2, meter))}%` }} data-tone={meter >= 90 ? "err" : meter >= 75 ? "attention" : "ok"} />
        </span>
      ) : (
        <span className="farm-stat-sub">{sub ?? " "}</span>
      )}
    </button>
  );
}

/** The farm at a glance and in hand: what every alt is doing, the buttons that move them all at once,
 * and what happened lately. Altbase's first page. */
export function FarmView({ accounts, onAdd }: { accounts: AccountSummary[]; onAdd: () => void }) {
  const now = useNow(1000);
  const instances = useInstances().data ?? [];
  const metrics = useMetrics().data ?? [];
  const crashes = useCrashes().data ?? [];
  const system = useSystemUsage(true).data;
  const favs = useFavourites().data ?? [];
  const groups = useGroups().data ?? [];
  const settings = useSettings().data;
  const multi = useMultiStatus().data;
  const batch = useBulk().data;
  const network = useNetwork().data;
  const step = useLaunchStep();
  const main = accounts.find((a) => a.main && a.status === "valid");
  const mainPresence = usePresence(main ? [main.id] : []).data?.get(main?.id ?? -1);

  const [filter, setFilter] = useState<Filter>("all");
  const [group, setGroup] = useState<number | null>(null);
  const [targetId, setTargetId] = useState(storedTarget);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(accounts, instances, metrics), [accounts, instances, metrics]);
  const stats = useMemo(() => farmStats(rows), [rows]);
  const feed = useMemo(() => feedOf(instances, crashes), [instances, crashes]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const inGroup = (r: Row) => group === null || r.account.groupIds.includes(group);
  const shown = rows.filter((r) => inGroup(r) && inFilter(r, filter));
  const counts = Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => inGroup(r) && inFilter(r, f)).length])) as Record<Filter, number>;

  const target: Favourite | undefined = favs.find((f) => String(f.id) === targetId) ?? favs[0];
  const idle = rows.filter((r) => inGroup(r) && r.phase === "idle" && !(r.account.main && settings?.protectMain));
  const down = rows.filter((r) => inGroup(r) && r.inst && (r.phase === "down" || (r.phase === "signIn" && r.inst.state === "disconnected")));
  const live = rows.filter((r) => r.inst && r.inst.state === "inGame");
  const block = publicBlock(network, settings) ?? launchBlocked(true, multi, batch) ?? (step ? step : null);
  const mainServer =
    mainPresence?.kind === "inGame" && mainPresence.placeId !== null && mainPresence.gameId ? { placeId: mainPresence.placeId, jobId: mainPresence.gameId } : null;
  const toMain = rows.filter((r) => inGroup(r) && !r.account.main && r.account.status === "valid" && r.inst?.jobId !== mainServer?.jobId);

  const pickTarget = (id: string) => {
    setTargetId(id);
    try {
      localStorage.setItem(TARGET_KEY, id);
    } catch {
      // Not kept: it lasts until Altbase closes.
    }
  };

  /** Runs one farm-wide action, one at a time, with its button busy meanwhile. */
  const act = (name: string, f: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    f().catch(toastError).finally(() => setBusy(null));
  };

  const launchIdle = () => {
    if (block) return toast(block, "error");
    if (!target) return requestNavigation("launch");
    if (!idle.length) return toast(t("farm.noneIdle"));
    act("launch", () => launchSame(idle.map((r) => r.account), target.target, { fpsCap: sessionFps() }));
  };
  const joinMain = () => {
    if (block) return toast(block, "error");
    if (!main) return toast(t("farm.noMain"));
    if (!mainServer) return toast(t("farm.mainNotInGame"));
    if (!toMain.length) return;
    act("main", () => launchSame(toMain.map((r) => r.account), { kind: "server", ...mainServer }, { fpsCap: sessionFps() }));
  };
  const hopAll = () =>
    block ? toast(block, "error") : act("hop", async () => {
      const group = live.filter((r) => inGroup(r));
      const place = stats.topPlace;
      const going = group.filter((r) => r.inst!.placeId === place);
      if (place === null || !going.length) return toast(t("farm.hopNothing"));
      const page = await api.serversList(place, "occupancyDesc", true, 50, undefined, going[0].account.id);
      const next = pickTogether(page.servers, going.length, new Set(going.flatMap((r) => (r.inst!.jobId ? [r.inst!.jobId] : []))));
      if (!next) return toast(t("dashboard.hopNone"));
      toast(t("farm.hopping", { count: going.length }));
      await launchEach(going.map((r) => ({ account: r.account, where: { kind: "server", placeId: place, jobId: next.id } as LaunchTarget, fpsCap: r.inst!.fpsCap })));
    });
  const rejoinDown = () =>
    act("rejoin", async () => {
      if (instances.some((i) => i.relaunchProblem)) await api.instancesRetryRelaunch();
      if (!down.length) return toast(t("farm.noneDown"));
      await launchEach(down.map((r) => ({ account: r.account, where: r.inst!.target, fpsCap: r.inst!.fpsCap })));
    });
  const trimAll = () => act("trim", () => api.memoryTrimClients().then((n) => toast(n ? t("palette.trimmed", { count: n }) : t("memory.trimNone"))));
  const tile = () => act("tile", () => api.instancesTile(false).then((n) => toast(t("farm.tiled", { count: n }))));
  const showAll = (what: "minimize" | "restore") => act(what, () => api.instancesShowAll(what));

  // Row actions.
  const hopOne = (r: Row) => {
    const i = r.inst;
    if (!i || i.placeId === null) return;
    act(`hop:${i.id}`, async () => {
      const page = await api.serversList(i.placeId!, "occupancyDesc", true, 25, undefined, r.account.id);
      const next = pickHop(page.servers, i.jobId, Math.random());
      if (!next) return toast(t("dashboard.hopNone"));
      await launchOne(r.account, { kind: "server", placeId: i.placeId!, jobId: next.id }, i.fpsCap);
    });
  };
  const playOne = (r: Row) => {
    if (r.inst) return act(`play:${r.account.id}`, () => launchOne(r.account, r.inst!.target, r.inst!.fpsCap));
    if (!target) return requestNavigation("launch");
    act(`play:${r.account.id}`, () => launchOne(r.account, target.target, sessionFps()));
  };
  const closeOne = (i: Instance) => act(`close:${i.id}`, () => api.instanceClose(i.id, false));
  const focusOne = (i: Instance) => void api.instanceShow(i.id, "focus").catch(toastError);

  // One-key moves while the Farm is on screen (not while typing or a dialog is open).
  const keys = useRef<Record<string, () => void>>({});
  keys.current = { l: launchIdle, m: joinMain, h: hopAll, r: rejoinDown, t: trimAll };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable], dialog[open], [popover]:popover-open")) return;
      if (document.querySelector("dialog[open]")) return;
      const f = keys.current[e.key.toLowerCase()];
      if (!f) return;
      e.preventDefault();
      f();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const memPct = system ? (system.memUsedMb / Math.max(1, system.memTotalMb)) * 100 : null;
  const runningCount = rows.filter((r) => r.inst).length;

  if (!accounts.length)
    return (
      <main className="farm scroll flex-1 min-w-0 page" aria-labelledby="farm-title">
        <div className="farm-empty panel">
          <Icon name="rocket" size={28} className="text-accent-text" />
          <h1 id="farm-title" className="page-title">{t("farm.emptyTitle")}</h1>
          <p className="text-fg-2">{t("farm.emptyText")}</p>
          <Button variant="primary" icon="plus" onClick={onAdd}>{t("accounts.add.title")}</Button>
        </div>
      </main>
    );

  return (
    <main className="farm scroll flex-1 min-w-0 page" aria-labelledby="farm-title">
      <header className="farm-head">
        <div className="min-w-0">
          <h1 id="farm-title" className="page-title">{t("farm.title")}</h1>
          <p className="farm-sub">
            <span className="farm-live-dot" data-on={stats.inGame > 0 || undefined} aria-hidden="true" />
            {stats.inGame > 0 && stats.topPlace !== null ? (
              <>
                {t("farm.subLive", { count: stats.inGame })} <span className="text-fg">· <GameName placeId={stats.topPlace} /></span>
                {stats.since !== null && <span className="text-fg-3"> · {t("farm.upFor", { time: short(now - stats.since) })}</span>}
              </>
            ) : (
              t("farm.subIdle")
            )}
          </p>
          {block && !step && (
            <p className="farm-block" role="status">
              <span aria-hidden="true" className="status-mark" data-shape="diamond" />
              {block}
            </p>
          )}
        </div>
        <div className="farm-launch">
          {favs.length > 0 ? (
            <Select
              aria-label={t("farm.target")}
              className="farm-target"
              value={target ? String(target.id) : ""}
              onChange={pickTarget}
              options={favs.map((f) => ({ value: String(f.id), label: f.name }))}
            />
          ) : (
            <Button variant="ghost" icon="star" onClick={() => requestNavigation("launch")}>{t("farm.pickGame")}</Button>
          )}
          <Button variant="primary" size="lg" icon="play" busy={busy === "launch"} disabled={!!block || !idle.length || !target} title={block ?? undefined} onClick={launchIdle}>
            {t("farm.launchIdle", { count: idle.length })}
          </Button>
        </div>
      </header>

      <section className="farm-stats" aria-label={t("farm.stats")}>
        <Stat icon="bolt" label={t("farm.stat.live")} value={fmtNum(stats.inGame)} of={`/${fmtNum(stats.ready)}`} sub={stats.joining ? t("farm.stat.joining", { count: stats.joining }) : t("farm.stat.liveSub")} tone={stats.inGame ? "ok" : "neutral"} onClick={() => setFilter("live")} />
        <Stat icon="alert" label={t("farm.stat.down")} value={fmtNum(stats.down)} sub={stats.down ? t("farm.stat.downSub") : t("farm.stat.allGood")} tone={stats.down ? "err" : "neutral"} onClick={() => setFilter("down")} />
        <Stat icon="accounts" label={t("farm.stat.idle")} value={fmtNum(stats.idle)} sub={t("farm.stat.idleSub", { count: stats.total - stats.ready })} onClick={() => setFilter("idle")} />
        <Stat icon="database" label={t("farm.stat.ram")} value={stats.measured ? mb(stats.ramMb) : "—"} sub={stats.measured ? t("farm.stat.ramEach", { size: mb(stats.ramMb / stats.measured) }) : t("farm.stat.noClients")} tone={stats.measured ? "info" : "neutral"} onClick={() => requestNavigation("monitor")} />
        <Stat icon="monitor" label={t("farm.stat.pc")} value={memPct === null ? "—" : `${Math.round(memPct)}%`} of={system?.cpuPct != null ? ` · ${Math.round(system.cpuPct)}% CPU` : undefined} meter={memPct} onClick={() => requestNavigation("performance")} />
        <Stat icon="refresh" label={t("farm.stat.rejoins")} value={fmtNum(stats.rejoins)} sub={stats.since !== null ? t("farm.upFor", { time: short(now - stats.since) }) : t("farm.stat.noClients")} tone={stats.rejoins ? "warn" : "neutral"} />
      </section>

      <div className="farm-actions" role="toolbar" aria-label={t("farm.actions")}>
        <Button icon="accounts" busy={busy === "main"} disabled={!mainServer || !toMain.length || !!block} title={main ? (mainServer ? undefined : t("farm.mainNotInGame")) : t("farm.noMain")} onClick={joinMain}>
          {t("farm.joinMain")}
        </Button>
        <Button icon="servers" busy={busy === "hop"} disabled={!live.length || !!block} onClick={hopAll}>{t("farm.hopAll")}</Button>
        <Button icon="refresh" busy={busy === "rejoin"} disabled={!down.length && !instances.some((i) => i.relaunchProblem)} onClick={rejoinDown}>
          {t("farm.rejoinDown", { count: down.length })}
        </Button>
        <span className="farm-actions-sep" aria-hidden="true" />
        <Button icon="database" busy={busy === "trim"} disabled={!runningCount} onClick={trimAll}>{t("farm.trimAll")}</Button>
        <Button icon="grid" busy={busy === "tile"} disabled={!runningCount} onClick={tile}>{t("farm.tile")}</Button>
        <Button icon="minimize" disabled={!runningCount} onClick={() => showAll("minimize")}>{t("farm.minimizeAll")}</Button>
        <Button icon="monitor" disabled={!runningCount} onClick={() => showAll("restore")}>{t("farm.restoreAll")}</Button>
        <span className="flex-1" />
        <KillAllButton compact />
      </div>
      <p className="farm-keys">{t("farm.keys")}</p>

      <div className="farm-body">
        <section className="panel farm-board" aria-label={t("farm.board")}>
          <div className="farm-board-head">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("farm.show")}>
              {FILTERS.map((f) => (
                <Chip key={f} small pressed={filter === f} count={counts[f]} onClick={() => setFilter(f)}>{t(FILTER_LABEL[f])}</Chip>
              ))}
            </div>
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("farm.groups")}>
                {groups.map((g) => (
                  <Chip key={g.id} small dot={g.color ?? undefined} pressed={group === g.id} onClick={() => setGroup(group === g.id ? null : g.id)}>{g.name}</Chip>
                ))}
              </div>
            )}
          </div>
          <div className="farm-table-wrap">
            <table className="farm-table">
              <thead>
                <tr>
                  <th scope="col">{t("farm.col.alt")}</th>
                  <th scope="col">{t("farm.col.state")}</th>
                  <th scope="col">{t("farm.col.where")}</th>
                  <th scope="col" className="farm-num">{t("farm.col.up")}</th>
                  <th scope="col" className="farm-num">{t("farm.col.ram")}</th>
                  <th scope="col" className="farm-num">{t("farm.col.cpu")}</th>
                  <th scope="col" className="farm-num">{t("farm.col.rejoins")}</th>
                  <th scope="col"><span className="sr-only">{t("farm.col.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const i = r.inst;
                  const tone = PHASE_TONE[r.phase];
                  const name = accountName(r.account);
                  return (
                    <tr key={r.account.id} data-phase={r.phase} style={{ ["--row" as string]: TONE_COLOR[tone] }}>
                      <td>
                        <span className="farm-alt">
                          <Avatar account={r.account} size={26} />
                          <span className="min-w-0 flex flex-col leading-tight">
                            <span className="font-semibold truncate">
                              {name}
                              {r.account.main && <span className="farm-main">{t("farm.main")}</span>}
                            </span>
                            <span className="text-fg-3 text-[12px] truncate sensitive">@{r.account.username}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <StatusPill tone={tone} shape={TONE_SHAPE[tone]} label={t(PHASE_LABEL[r.phase])} pulse={r.phase === "joining" || r.phase === "starting" || r.phase === "rejoining"} />
                      </td>
                      <td className="farm-where">
                        {i?.placeId != null ? (
                          <span className="flex flex-col leading-tight min-w-0">
                            <span className="truncate"><GameName placeId={i.placeId} /></span>
                            <span className="text-fg-3 text-[12px] font-mono truncate sensitive">{i.jobId ? i.jobId.slice(0, 8) : t("farm.findingServer")}</span>
                          </span>
                        ) : i?.note || i?.relaunchProblem ? (
                          <span className="text-fg-3 text-[12px] truncate">{i.relaunchProblem ?? i.note}</span>
                        ) : (
                          <span className="text-fg-3">—</span>
                        )}
                      </td>
                      <td className="farm-num">{i ? short(now - i.startedAt) : "—"}</td>
                      <td className="farm-num">{r.metric ? mb(r.metric.memoryMb) : "—"}</td>
                      <td className="farm-num">{r.metric?.cpuPct != null ? `${r.metric.cpuPct.toFixed(1)}%` : "—"}</td>
                      <td className="farm-num">{i ? fmtNum(i.rejoins) : "—"}</td>
                      <td>
                        <span className="farm-row-actions">
                          {i && i.state !== "exited" && <IconButton size="sm" icon="eye" label={t("farm.focus", { name })} onClick={() => focusOne(i)} />}
                          {i?.state === "inGame" && <IconButton size="sm" icon="servers" label={t("dashboard.hop")} disabled={!!step} onClick={() => hopOne(r)} />}
                          {r.account.status === "valid" && (
                            <IconButton
                              size="sm"
                              icon={i ? "refresh" : "play"}
                              label={i ? t("farm.rejoinOne", { name }) : target ? t("farm.playOne", { name, game: target.name }) : t("farm.pickGame")}
                              disabled={!!step || busy === `play:${r.account.id}`}
                              onClick={() => playOne(r)}
                            />
                          )}
                          {i && <IconButton size="sm" icon="x" label={t("farm.closeOne", { name })} disabled={busy === `close:${i.id}`} onClick={() => closeOne(i)} />}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={8} className="farm-none">{t("farm.nothingHere")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel farm-feed" aria-labelledby="farm-feed-title">
          <h2 id="farm-feed-title" className="section-title">{t("farm.feed.title")}</h2>
          <ol className="farm-feed-list">
            {feed.map((e) => {
              const a = byId.get(e.accountId);
              const tone = FEED_TONE[e.kind];
              return (
                <li key={e.id} className="farm-event" style={{ ["--ev" as string]: TONE_COLOR[tone] }}>
                  <span className="farm-event-mark" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-semibold truncate">{a ? accountName(a) : t("farm.removedAccount")}</span>
                      <span className="farm-event-kind">{t(FEED_LABEL[e.kind])}</span>
                    </span>
                    {e.reason && <span className="block text-fg-3 text-[12px] truncate" title={e.reason}>{e.reason}</span>}
                    {e.uptimeMs !== null && <span className="block text-fg-3 text-[12px]">{t("farm.feed.after", { time: short(e.uptimeMs) })}</span>}
                  </span>
                  <time className="farm-event-at" dateTime={new Date(e.at).toISOString()}>{t("farm.ago", { time: short(now - e.at) })}</time>
                </li>
              );
            })}
            {!feed.length && <li className="farm-none">{t("farm.feed.empty")}</li>}
          </ol>
        </aside>
      </div>
    </main>
  );
}
