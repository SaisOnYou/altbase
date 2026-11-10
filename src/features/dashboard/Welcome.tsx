import type { ReactNode } from "react";
import type { AccountSummary, Favourite } from "../../api";
import { requestNavigation } from "../../app/navigation";
import { publicBlock, useBulk, useFavourites, useInstances, useMultiStatus, useNetwork, useSettings, useSystemUsage } from "../../data";
import { fmtList, fmtNum, t, type Key } from "../../i18n";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { ListPresence } from "../../ui/motion";
import { accountName, Avatar } from "../accounts/shared";
import { LaunchButton } from "../launch/LaunchButton";
import { launchBlocked, launchOne, launchSame, sessionFps } from "../launch/launchQueue";
import { isLive } from "../launch/Running";
import { describeTarget, draftFor } from "../launch/target";

const STEPS: [Key, Key][] = [
  ["home.step1", "home.step1Text"],
  ["home.step2", "home.step2Text"],
  ["home.step3", "home.step3Text"],
];

/** The favourites, each a click from playing with its default accounts (and Play's FPS cap for this
 * session), or from Play with it filled in. */
function QuickPlay({ accounts, onPick }: { accounts: AccountSummary[]; onPick?: (f: Favourite) => void }) {
  const favs = useFavourites();
  const instances = useInstances().data ?? [];
  const multi = useMultiStatus().data;
  const batch = useBulk().data;
  const settings = useSettings().data;
  const network = useNetwork().data;
  if (favs.isError) return <p className="text-[13px] text-fg-2">{t("launch.fav.loadFailed")}</p>;
  if (!favs.data?.length) return null;
  const live = new Set(instances.filter(isLive).map((i) => i.accountId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return (
    <section aria-labelledby="home-favs" className="flex flex-col gap-2.5">
      <h2 id="home-favs" className="section-title">{t("launch.fav.title")}</h2>
      <ListPresence
        as="ul"
        items={favs.data}
        getKey={(f) => f.id}
        className="home-favgrid"
        itemClassName="home-favcard panel"
        render={(f) => {
          const who = f.accountIds.map((id) => byId.get(id)).filter((a): a is AccountSummary => !!a);
          const ready = who.filter((a) => a.status === "valid" && !live.has(a.id));
          const look = describeTarget(f.target);
          const where = { draft: draftFor(f.target, f.id, f.name), setDraft: () => {} };
          const block = publicBlock(network, settings) ?? launchBlocked(ready.length > 1, multi, batch);
          return (
            <div className="home-fav-row">
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon name="star" size={14} fill className="flex-none mt-1 text-fg-3" />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-semibold truncate">{f.name}</span>
                  <span className="text-[13px] text-fg-2 truncate">{look.kind} · {look.detail}</span>
                </span>
                {who.length > 0 && (
                  <span className="home-who" data-tip={fmtList(who.map(accountName))}>
                    {who.slice(0, 4).map((a) => (
                      <Avatar key={a.id} account={a} size={22} />
                    ))}
                    {who.length > 4 && <span className="home-who-more">+{who.length - 4}</span>}
                    <span className="sr-only">{fmtList(who.map(accountName))}</span>
                  </span>
                )}
              </div>
              <div className="home-fav-actions">
                {ready.length > 0 && (
                  <LaunchButton
                    label={t("home.playNow")}
                    disabled={block !== null}
                    onLaunch={() => void (ready.length === 1 ? launchOne(ready[0], where, sessionFps()) : launchSame(ready, where, { fpsCap: sessionFps() }))}
                  />
                )}
                {onPick && (
                  <Button variant="ghost" onClick={() => onPick(f)}>
                    {t("common.playEllipsis")}
                  </Button>
                )}
                {ready.length > 0 && block && <p className="home-fav-why">{block}</p>}
              </div>
            </div>
          );
        }}
      />
    </section>
  );
}

/** A meter's tone by how full it is; the number beside it always says how much. */
const tone = (pct: number) => (pct >= 90 ? "err" : pct >= 75 ? "attention" : "ok");

/** Home at a glance: accounts ready, clients running, and how busy the PC is. Each tile opens the
 * view behind its number. */
function Glance({ accounts }: { accounts: AccountSummary[] }) {
  const running = (useInstances().data ?? []).filter(isLive).length;
  const sys = useSystemUsage(true).data;
  const ready = accounts.filter((a) => a.status === "valid").length;
  const needs = accounts.length - ready;
  const cpu = sys?.cpuPct ?? null;
  const mem = sys ? (sys.memUsedMb / Math.max(1, sys.memTotalMb)) * 100 : null;
  const gb = (mbs: number) => t("monitor.gb", { n: fmtNum(mbs / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  return (
    <section aria-label={t("home.glance.title")} className="glance-row">
      <button type="button" className="glance" onClick={() => requestNavigation("accounts")}>
        <span className="glance-label"><Icon name="accounts" size={15} />{t("home.glance.accounts")}</span>
        <span className="glance-value">{fmtNum(ready)}<span className="glance-of">/ {fmtNum(accounts.length)}</span></span>
        <span className="glance-sub" data-tone={needs ? "attention" : undefined}>{needs ? t("home.glance.needSignIn", { count: needs }) : t("home.glance.allReady")}</span>
      </button>
      <button type="button" className="glance" onClick={() => requestNavigation("monitor")}>
        <span className="glance-label"><Icon name="play" size={15} />{t("home.robloxClients")}</span>
        <span className="glance-value">{fmtNum(running)}</span>
        <span className="glance-sub">{running ? t("home.glance.running") : t("home.glance.none")}</span>
      </button>
      <button type="button" className="glance" onClick={() => requestNavigation("performance")}>
        <span className="glance-label"><Icon name="gauge" size={15} />{t("home.cpu")}</span>
        <span className="glance-value">{cpu === null ? "–" : `${fmtNum(Math.round(cpu))}%`}</span>
        <span className="glance-meter" data-tone={cpu === null ? undefined : tone(cpu)} aria-hidden="true"><span style={{ width: `${Math.min(100, cpu ?? 0)}%` }} /></span>
      </button>
      <button type="button" className="glance" onClick={() => requestNavigation("monitor")}>
        <span className="glance-label"><Icon name="database" size={15} />{t("home.memory")}</span>
        <span className="glance-value">{mem === null ? "–" : `${fmtNum(Math.round(mem))}%`}</span>
        <span className="glance-meter" data-tone={mem === null ? undefined : tone(mem)} aria-hidden="true"><span style={{ width: `${Math.min(100, mem ?? 0)}%` }} /></span>
        {sys && <span className="glance-sub">{t("home.memOf", { used: gb(sys.memUsedMb), total: gb(sys.memTotalMb) })}</span>}
      </button>
    </section>
  );
}

/** Home with nothing running: three steps to a first game (no accounts), the way back in (all signed
 * out), or the way to a game and the favourites (idle). `toolbar` and `extra` go in the header,
 * `notice` under it. */
export function Welcome({ accounts, toolbar, extra, notice, onAdd, onImport, onAccounts, onPickFavourite }: {
  accounts: AccountSummary[];
  toolbar: ReactNode;
  extra: ReactNode;
  notice: ReactNode;
  onAdd: () => void;
  onImport: () => void;
  onAccounts: () => void;
  onPickFavourite?: (f: Favourite) => void;
}) {
  const head = (title: string, lead: string, end?: ReactNode) => (
    <>
      <header className="home-head">
        <div className="min-w-0 max-w-[640px]">
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{lead}</p>
        </div>
        {end && <div className="home-head-end">{end}</div>}
      </header>
      {notice}
    </>
  );

  if (!accounts.length)
    return (
      <>
        {head(t("home.welcome"), t("home.welcomeLead"))}
        <ol className="panel home-steps">
          {STEPS.map(([title, text], n) => (
            <li key={title} className="home-step">
              <span className="num">{n + 1}</span>
              <span className="flex-[1_1_260px] min-w-0 flex flex-col gap-0.5">
                <span className="font-semibold">{t(title)}</span>
                <span className="text-[13px] text-fg-2">{t(text)}</span>
              </span>
              {n === 0 && (
                <Button variant="primary" icon="plus" onClick={onAdd}>
                  {t("accounts.add.title")}
                </Button>
              )}
            </li>
          ))}
        </ol>
        <p className="flex flex-wrap items-center gap-x-1 text-fg-2">
          {t("home.importLead")}
          <Button variant="ghost" size="md" icon="download" onClick={onImport}>
            {t("home.import")}
          </Button>
        </p>
      </>
    );

  if (accounts.every((a) => a.status !== "valid"))
    return (
      <>
        {head(t("home.signedOutTitle"), t("home.signedOutLead"), <>{toolbar}{extra}</>)}
        <div>
          <Button variant="primary" icon="accounts" onClick={onAccounts}>
            {t("app.nav.accounts")}
          </Button>
        </div>
      </>
    );

  return (
    <>
      {head(t("home.idle"), t("home.idleLead"), <>{toolbar}{extra}</>)}
      <Glance accounts={accounts} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="play" onClick={() => requestNavigation("launch")}>
          {t("home.chooseGame")}
        </Button>
        <Button icon="plus" onClick={onAdd}>{t("accounts.add.title")}</Button>
        <Button icon="servers" onClick={() => requestNavigation("servers")}>{t("app.nav.servers")}</Button>
        <Button icon="gauge" onClick={() => requestNavigation("performance")}>{t("app.nav.performance")}</Button>
      </div>
      <QuickPlay accounts={accounts} onPick={onPickFavourite} />
    </>
  );
}
