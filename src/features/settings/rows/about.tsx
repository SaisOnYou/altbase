import { t } from "../../../i18n";
import { SettingRow } from "../kit/SettingRow";

/** The app's own version and its credits: the one place they show. No update channel. */
export function VersionRow() {
  const version = import.meta.env.APP_VERSION;
  return (
    <SettingRow id="version" name={`Altbase ${version}`} title={<span className="set-label">Altbase <span className="mono">{version}</span></span>}>
      <span className="flex flex-col items-end gap-0.5 text-right text-[13px]">
        <span>{t("settings.credits", { names: "sais7777 & ceficat" })}</span>
        <span className="text-fg-3">{t("settings.builtWith")}</span>
      </span>
    </SettingRow>
  );
}
