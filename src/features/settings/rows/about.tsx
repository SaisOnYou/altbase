import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../../../api";
import { qk } from "../../../data";
import { t } from "../../../i18n";
import { Button } from "../../../ui/Button";
import { Switch } from "../../../ui/controls";
import { ActionButton } from "../kit/ActionButton";
import { useRow } from "../kit/rowError";
import { SettingRow } from "../kit/SettingRow";
import { unhideUpdate } from "../UpdateBanner";

const RELEASES = "https://github.com/SaisOnYou/altbase/releases";

/** Check now (and what it found) beside the switch for the background checks. A found update shows
 * in the island again, even one Later hid. */
function SelfUpdate() {
  const row = useRow();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    row.setError(null);
    row.setResult(null);
    try {
      const u = await api.selfUpdateCheck();
      unhideUpdate();
      qc.setQueryData(qk.appUpdate, u);
      row.setResult(u.available ? t("settings.updateAvailable", { version: u.available }) : t("settings.upToDate"));
    } catch (e) {
      row.fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ActionButton busy={busy} label={t("settings.checkNow")} busyLabel={t("settings.checking")} onRun={() => void check()} />
      <Switch label={t("settings.selfUpdate")} checked={row.ctx.s.selfUpdate} onChange={(selfUpdate) => void row.write({ selfUpdate })} describedBy={row.describedBy} />
    </>
  );
}

export function SelfUpdateRow() {
  return (
    <SettingRow id="selfUpdate">
      <SelfUpdate />
    </SettingRow>
  );
}

function Releases() {
  const row = useRow();
  return (
    <Button size="md" iconEnd="external" aria-describedby={row.describedBy} onClick={() => openUrl(RELEASES).catch(row.fail)}>
      {t("settings.openReleases")}
    </Button>
  );
}

/** The app's own version and its credits, with the releases page. */
export function VersionRow() {
  const version = import.meta.env.APP_VERSION;
  return (
    <SettingRow id="version" name={`Altbase ${version}`} title={<span className="set-label">Altbase <span className="mono">{version}</span></span>}>
      <span className="flex flex-col items-end gap-0.5 text-right text-[13px]">
        <span>{t("settings.credits", { names: "sais7777 & ceficat" })}</span>
        <span className="text-fg-3">{t("settings.builtWith")}</span>
      </span>
      <Releases />
    </SettingRow>
  );
}
