import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSummary, Favourite } from "../api";
import { api } from "../api";
import { useFavourites } from "../data";
import { accountName, Avatar } from "../features/accounts/shared";
import { AREAS } from "../features/settings/areas";
import { jumpTo } from "../features/settings/jump";
import { ENTRIES, say } from "../features/settings/registry";
import { fold } from "../features/settings/search";
import { t } from "../i18n";
import { Icon, type IconName } from "../ui/Icon";
import { setStreamer, useStreamer } from "../ui/streamer";
import { toast, toastError } from "../ui/Toast";
import { MAIN_SECTIONS, requestNavigation, SECTION_ICON, SECTION_VIEW, TOOL_SECTIONS, VIEW_NAME } from "./navigation";

/** One thing the palette can do: found by `text` (and `more`), shown under `group`. */
type Command = {
  id: string;
  group: string;
  text: string;
  /** Extra words to find it by, never shown. */
  more?: string;
  hint?: string;
  icon?: IconName;
  account?: AccountSummary;
  run: () => void;
};

const LIMIT = 40;

/** How well `q` (folded words) finds a command (pure): every word must appear; a match at the start
 * of the text ranks first, then anywhere in it, then in its extra words. 0: no match. */
export function score(words: string[], text: string, more = ""): number {
  const a = fold(text);
  const b = fold(more);
  let total = 0;
  for (const w of words) {
    if (a.startsWith(w)) total += 4;
    else if (a.includes(` ${w}`)) total += 3;
    else if (a.includes(w)) total += 2;
    else if (b.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

/** Ctrl+K: type to find a page, an account, a favourite, an action or any setting, Enter to go.
 * A list of what you can do, so nothing has to be remembered. */
export function CommandPalette({ open, onClose, accounts, onAdd, onPlayAs, onOpenAccount, onPickFavourite }: {
  open: boolean;
  onClose: () => void;
  accounts: AccountSummary[];
  onAdd: () => void;
  onPlayAs: (id: number) => void;
  onOpenAccount: (id: number) => void;
  onPickFavourite: (f: Favourite) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const favs = useFavourites().data;
  const streamer = useStreamer();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setAt(0);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    if (!open) return [];
    const pages = t("palette.pages");
    const actions = t("palette.actions");
    const out: Command[] = [];
    for (const s of [...MAIN_SECTIONS, ...TOOL_SECTIONS]) {
      const v = SECTION_VIEW[s];
      out.push({ id: `page:${s}`, group: pages, text: t(VIEW_NAME[v]), icon: SECTION_ICON[s], run: () => requestNavigation(v) });
    }
    for (const a of AREAS) out.push({ id: `area:${a.id}`, group: pages, text: `${t("app.nav.settings")} › ${t(a.label)}`, icon: a.icon, run: () => requestNavigation("settings", a.id) });
    out.push({ id: "act:add", group: actions, text: t("accounts.add.title"), icon: "plus", hint: "Ctrl+N", run: onAdd });
    out.push({ id: "act:streamer", group: actions, text: streamer ? t("palette.streamerOff") : t("palette.streamerOn"), more: "stream hide names obs", icon: "eye", run: () => setStreamer(!streamer) });
    out.push({
      id: "act:trim",
      group: actions,
      text: t("memory.trim"),
      more: "ram memory free",
      icon: "database",
      run: () => void api.memoryTrimClients().then((n) => toast(n ? t("palette.trimmed", { count: n }) : t("memory.trimNone")), toastError),
    });
    for (const f of favs ?? []) out.push({ id: `fav:${f.id}`, group: t("launch.fav.title"), text: f.name, more: "play favourite", icon: "star", run: () => onPickFavourite(f) });
    for (const a of accounts) {
      const name = accountName(a);
      const more = `${a.username} ${a.displayName} ${a.alias}`;
      if (a.status === "valid") out.push({ id: `play:${a.id}`, group: t("palette.playAs"), text: name, more: `${more} play launch`, account: a, hint: `@${a.username}`, run: () => onPlayAs(a.id) });
      out.push({ id: `acct:${a.id}`, group: t("app.nav.accounts"), text: name, more, account: a, hint: `@${a.username}`, run: () => onOpenAccount(a.id) });
    }
    for (const e of ENTRIES) {
      if (e.parent || e.id.startsWith("key.")) continue;
      out.push({ id: `set:${e.id}`, group: t("app.nav.settings"), text: say(e.label), more: (e.aliases ?? []).join(" "), icon: "sliders", run: () => jumpTo(e.id) });
    }
    return out;
  }, [open, accounts, favs, streamer, onAdd, onPlayAs, onOpenAccount, onPickFavourite]);

  const found = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    // Nothing typed: the pages and actions, then favourites; accounts and settings need a word.
    if (!words.length) return commands.filter((c) => /^(page|act|fav):/.test(c.id)).slice(0, LIMIT);
    return commands
      .map((c, i) => ({ c, i, s: score(words, c.text, c.more) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .slice(0, LIMIT)
      .map((x) => x.c);
  }, [commands, q]);

  const active = Math.min(at, Math.max(0, found.length - 1));
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, found]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = "";
  return (
    <dialog
      ref={dialog}
      className="dlg palette"
      aria-label={t("palette.title")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={(e) => e.target === dialog.current && onClose()}
    >
      {open && (
        <div className="palette-body">
          <div className="palette-field">
            <Icon name="search" size={16} className="text-fg-3" />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={found[active] ? `palette-${active}` : undefined}
              aria-label={t("palette.title")}
              placeholder={t("palette.placeholder")}
              value={q}
              autoFocus
              spellCheck={false}
              onChange={(e) => {
                setQ(e.target.value);
                setAt(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setAt((active + 1) % Math.max(1, found.length)));
                else if (e.key === "ArrowUp") (e.preventDefault(), setAt((active - 1 + found.length) % Math.max(1, found.length)));
                else if (e.key === "Home" && !q) (e.preventDefault(), setAt(0));
                else if (e.key === "Enter") (e.preventDefault(), run(found[active]));
              }}
            />
            <kbd className="kbd">Esc</kbd>
          </div>
          <ul ref={list} id="palette-list" role="listbox" aria-label={t("palette.results")} className="palette-list">
            {found.map((c, i) => {
              const head = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <li key={c.id} role="presentation">
                  {head && <div className="palette-group" role="presentation">{head}</div>}
                  <div
                    id={`palette-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={i === active}
                    className="palette-item"
                    onMouseMove={() => i !== active && setAt(i)}
                    onClick={() => run(c)}
                  >
                    {c.account ? <Avatar account={c.account} size={22} /> : <Icon name={c.icon ?? "chevron"} size={16} className="flex-none text-fg-2" />}
                    <span className="flex-1 min-w-0 truncate">{c.text}</span>
                    {c.hint && <span className="palette-hint">{c.hint}</span>}
                  </div>
                </li>
              );
            })}
            {!found.length && <li className="palette-empty">{t("palette.nothing", { q })}</li>}
          </ul>
          <div className="palette-foot" aria-hidden="true">
            <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> {t("palette.move")}</span>
            <span><kbd className="kbd">Enter</kbd> {t("palette.go")}</span>
          </div>
        </div>
      )}
    </dialog>
  );
}
