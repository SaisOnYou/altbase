import { t } from "../../../i18n";
import { Segmented, Switch } from "../../../ui/controls";
import { setPrefs, TEXT_SIZES, usePrefs, type Prefs } from "../../../ui/prefs";
import { useRow } from "../kit/rowError";
import { SettingRow } from "../kit/SettingRow";

/** The whole interface scaled; applies at once. */
export function TextSizeRow() {
  const size = usePrefs().textSize;
  return (
    <SettingRow id="textSize">
      <Segmented
        label={t("settings.textSize")}
        value={String(size)}
        onChange={(v) => setPrefs({ textSize: Number(v) })}
        options={TEXT_SIZES.map((n) => ({ value: String(n), label: `${n}%` }))}
      />
    </SettingRow>
  );
}

/** One of this PC's on/off choices. */
function PrefSwitch({ field, label }: { field: "boldFocus" | "readableFont" | "navLabels" | "underlineLinks"; label: string }) {
  const row = useRow();
  const on = usePrefs()[field];
  return <Switch label={label} checked={on} onChange={(v) => setPrefs({ [field]: v } as Partial<Prefs>)} describedBy={row.describedBy} />;
}

export function ContrastRow() {
  const row = useRow();
  const more = usePrefs().contrast === "more";
  return <Switch label={t("settings.contrast")} checked={more} onChange={(v) => setPrefs({ contrast: v ? "more" : "normal" })} describedBy={row.describedBy} />;
}

const pref = (id: string, field: Parameters<typeof PrefSwitch>[0]["field"], label: Parameters<typeof t>[0]) =>
  function Row() {
    return (
      <SettingRow id={id}>
        <PrefSwitch field={field} label={t(label)} />
      </SettingRow>
    );
  };

export function ContrastSettingRow() {
  return (
    <SettingRow id="contrast">
      <ContrastRow />
    </SettingRow>
  );
}
export const BoldFocusRow = pref("boldFocus", "boldFocus", "settings.boldFocus");
export const ReadableFontRow = pref("readableFont", "readableFont", "settings.readableFont");
export const NavLabelsRow = pref("navLabels", "navLabels", "settings.navLabels");
export const UnderlineLinksRow = pref("underlineLinks", "underlineLinks", "settings.underlineLinks");
