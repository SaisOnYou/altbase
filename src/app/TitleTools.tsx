import type { VaultMode } from "../api";
import { t } from "../i18n";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IconSwap } from "../ui/motion";
import { setStreamer, useStreamer } from "../ui/streamer";

/** The title bar's own keys: refresh (as F5), the layout, the theme, and the vault (a lock key with a
 * master password, else the encryption's state). */
export function TitleTools({ dark, onRefresh, onToggleTheme, sideTabs, onToggleTabs, onLock, vaultMode }: {
  dark: boolean;
  onRefresh?: () => void;
  onToggleTheme?: () => void;
  sideTabs?: boolean;
  onToggleTabs?: () => void;
  onLock?: () => void;
  vaultMode?: VaultMode;
}) {
  return (
    <div className="title-tools">
      {onRefresh && <IconButton icon="refresh" label={t("ui.refresh")} shortcut="F5" onClick={onRefresh} />}
      <StreamerToggle />
      {onToggleTabs && (
        <IconButton icon={sideTabs ? "layoutTop" : "layoutSide"} label={sideTabs ? t("ui.accountsTop") : t("ui.accountsSide")} onClick={onToggleTabs} />
      )}
      {onToggleTheme && (
        <button type="button" className="wc" aria-label={dark ? t("ui.lightTheme") : t("ui.darkTheme")} data-tip={dark ? t("ui.lightTheme") : t("ui.darkTheme")} onClick={onToggleTheme}>
          <IconSwap name={dark ? "sun" : "moon"} />
        </button>
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
