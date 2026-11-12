import type { VaultMode } from "../api";
import { t } from "../i18n";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { setStreamer, useStreamer } from "../ui/streamer";

/** The title bar's own keys: search, refresh (as F5), streamer mode, the layout and the vault (a
 * lock key with a master password, else the encryption's state). */
export function TitleTools({ onRefresh, sideTabs, onToggleTabs, onLock, vaultMode }: {
  onRefresh?: () => void;
  sideTabs?: boolean;
  onToggleTabs?: () => void;
  onLock?: () => void;
  vaultMode?: VaultMode;
}) {
  return (
    <div className="title-tools">
      {onRefresh && <IconButton icon="search" label={t("palette.title")} shortcut="Ctrl+K" onClick={() => window.dispatchEvent(new Event("altbase:palette"))} />}
      {onRefresh && <IconButton icon="refresh" label={t("ui.refresh")} shortcut="F5" onClick={onRefresh} />}
      <StreamerToggle />
      {onToggleTabs && (
        <IconButton icon={sideTabs ? "layoutTop" : "layoutSide"} label={sideTabs ? t("ui.accountsTop") : t("ui.accountsSide")} onClick={onToggleTabs} />
      )}
      {onLock ? (
        <IconButton icon="lock" label={t("ui.lockVault")} shortcut="Ctrl+L" onClick={onLock} />
      ) : (
        vaultMode === "dpapi" && (
          <span className="vault-glyph" role="img" aria-label={t("app.vaultUnlockedDpapi")} data-tip={t("app.encrypted")}>
            <Icon name="shield" />
          </span>
        )
      )}
    </div>
  );
}

/** Streamer mode, one click away: names masked, ids and cookies hidden (`ui/streamer`). */
function StreamerToggle() {
  const on = useStreamer();
  const label = on ? t("settings.streamerOff") : t("settings.streamerOn");
  return (
    <button type="button" className="wc" aria-pressed={on} aria-label={label} data-tip={label} data-on={on || undefined} onClick={() => setStreamer(!on)}>
      <Icon name={on ? "eyeOff" : "eye"} size={16} />
    </button>
  );
}
