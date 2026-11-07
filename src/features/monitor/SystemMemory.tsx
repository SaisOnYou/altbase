import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type EmptyList, type MemoryLists } from "../../api";
import { qk, useMemoryLists } from "../../data";
import { fmtNum, t, type Key } from "../../i18n";
import { Button } from "../../ui/Button";
import { MenuItem, MenuSeparator, Popover, useAnchor } from "../../ui/Popover";
import { toast, toastError } from "../../ui/Toast";

const one = (n: number) => fmtNum(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const size = (n: number) => (n >= 1024 ? t("monitor.gb", { n: one(n / 1024) }) : t("monitor.mb", { n: fmtNum(Math.round(n)) }));

/** The four lists, in RAMMap's order, each with its colour (a word beside it always says which). */
const LISTS: { field: keyof Omit<MemoryLists, "totalMb">; label: Key; hint: Key; color: string }[] = [
  { field: "inUseMb", label: "memory.inUse", hint: "memory.inUseHint", color: "var(--fg-2)" },
  { field: "modifiedMb", label: "memory.modified", hint: "memory.modifiedHint", color: "var(--attention)" },
  { field: "standbyMb", label: "memory.standby", hint: "memory.standbyHint", color: "var(--info)" },
  { field: "freeMb", label: "memory.free", hint: "memory.freeHint", color: "var(--ok)" },
];

/** RAMMap in Monitor: what the PC's memory holds now, a trim of every Roblox client (no admin), and
 * RAMMap's Empty commands (one administrator prompt each time, `memory::empty`). */
export function SystemMemory() {
  const lists = useMemoryLists();
  const qc = useQueryClient();
  const anchor = useAnchor();
  const [busy, setBusy] = useState<"trim" | "clean" | null>(null);
  const m = lists.data;
  const shown = m && m.totalMb > 0 ? m : null;

  /** Runs `job`, then says what it changed: in use down, free up. */
  async function run(kind: "trim" | "clean", job: () => Promise<string | null>) {
    setBusy(kind);
    const before = qc.getQueryData<MemoryLists>(qk.memory);
    try {
      const said = await job();
      const after = await qc.fetchQuery({ queryKey: qk.memory, queryFn: api.memoryLists, staleTime: 0 });
      if (said !== null) toast(said);
      else if (before && after.totalMb > 0)
        toast(t("memory.result", { inUse: size(Math.max(0, before.inUseMb - after.inUseMb)), free: size(Math.max(0, after.freeMb - before.freeMb)) }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  const trim = () =>
    run("trim", async () => {
      const n = await api.memoryTrimClients();
      return n === 0 ? t("memory.trimNone") : null;
    });
  const clean = (what: EmptyList[]) =>
    run("clean", async () => {
      await api.memoryEmpty(what);
      return null;
    });

  const id = "memory-clean";
  return (
    <section aria-labelledby="mem-title" className="panel mem">
      <header className="mem-head">
        <div className="min-w-0">
          <h2 id="mem-title" className="section-title">{t("memory.title")}</h2>
          {shown && <p className="meta">{t("memory.total", { size: size(shown.totalMb) })}</p>}
        </div>
        <div className="mem-actions">
          <Button size="md" icon="refresh" busy={busy === "trim"} disabled={busy !== null} onClick={() => void trim()}>
            {t("memory.trim")}
          </Button>
          <Button size="md" iconEnd="chevron" busy={busy === "clean"} disabled={busy !== null} popoverTarget={id} style={anchor.style} aria-haspopup="menu">
            {t("memory.clean")}
          </Button>
          <Popover id={id} anchor={anchor.name} placement="below-end" role="menu" label={t("memory.clean")} className="w-[280px]">
            <p className="px-2.5 pt-1.5 pb-2 text-[13px] text-fg-3">{t("memory.adminNote")}</p>
            <MenuSeparator />
            <MenuItem icon="database" onSelect={() => void clean(["standbyList"])}>{t("memory.emptyStandby")}</MenuItem>
            <MenuItem icon="download" onSelect={() => void clean(["modifiedList"])}>{t("memory.emptyModified")}</MenuItem>
            <MenuItem icon="grid" onSelect={() => void clean(["workingSets"])}>{t("memory.emptyWorkingSets")}</MenuItem>
            <MenuSeparator />
            <MenuItem icon="bolt" onSelect={() => void clean(["workingSets", "modifiedList", "standbyList"])}>{t("memory.emptyAll")}</MenuItem>
          </Popover>
        </div>
      </header>

      {shown ? (
        <>
          <div className="mem-bar" role="img" aria-label={LISTS.map((l) => `${t(l.label)} ${size(shown[l.field])}`).join(", ")}>
            {LISTS.map((l) => (
              <span key={l.field} style={{ flexGrow: shown[l.field], background: l.color }} />
            ))}
          </div>
          <dl className="mem-legend">
            {LISTS.map((l) => (
              <div key={l.field} data-tip={t(l.hint)}>
                <dt>
                  <span className="mem-dot" style={{ background: l.color }} aria-hidden="true" />
                  {t(l.label)}
                </dt>
                <dd className="num-tab">{size(shown[l.field])}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="meta">{lists.isPending ? t("common.loading") : t("memory.unavailable")}</p>
      )}
    </section>
  );
}
