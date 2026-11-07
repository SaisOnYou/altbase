import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, asError, type AccountSettingsPatch, type AccountSummary, type PrivacyLevel } from "../../api";
import { t, type Key } from "../../i18n";
import { Button } from "../../ui/Button";
import { Segmented } from "../../ui/controls";
import { Dialog } from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";
import { friendly, toast } from "../../ui/Toast";

type Choice = PrivacyLevel | "keep";
const CHOICES: { value: Choice; label: Key }[] = [
  { value: "keep", label: "accounts.settings.keep" },
  { value: "everyone", label: "accounts.settings.everyone" },
  { value: "friends", label: "accounts.settings.friends" },
  { value: "noOne", label: "accounts.settings.noOne" },
];
const ROWS: { field: "whoCanJoin" | "onlineStatus" | "inventory"; label: Key }[] = [
  { field: "whoCanJoin", label: "accounts.settings.whoCanJoin" },
  { field: "onlineStatus", label: "accounts.settings.onlineStatus" },
  { field: "inventory", label: "accounts.settings.inventory" },
];
const KEEP_ALL = { whoCanJoin: "keep", onlineStatus: "keep", inventory: "keep" } as const satisfies Record<(typeof ROWS)[number]["field"], Choice>;

/** Account settings: one display name pattern and Roblox privacy choices for the chosen signed-in
 * accounts. "Keep" leaves a setting as each account has it. */
export function AccountSettingsDialog({ ids, accounts, onClose }: { ids: number[] | null; accounts: AccountSummary[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [privacy, setPrivacy] = useState<Record<keyof typeof KEEP_ALL, Choice>>(KEEP_ALL);
  const [error, setError] = useState<string | null>(null);
  const valid = (ids ?? []).filter((id) => accounts.find((a) => a.id === id)?.status === "valid");
  const label = (id: number) => accounts.find((a) => a.id === id)?.username;
  const patch: AccountSettingsPatch = {
    ...(name.trim() ? { displayName: name.trim() } : {}),
    ...Object.fromEntries(ROWS.filter((r) => privacy[r.field] !== "keep").map((r) => [r.field, privacy[r.field]])),
  };
  const changes = Object.keys(patch).length > 0;
  const close = () => {
    setName("");
    setPrivacy(KEEP_ALL);
    setError(null);
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api.accountsUpdateSettings(valid, patch),
    onSuccess: (r) => {
      const names = r.challenged.map(label).filter(Boolean).join(", ");
      toast(
        [
          t("accounts.settings.changed", { count: r.changed }),
          r.failed && t("accounts.settings.failed", { count: r.failed, why: r.firstError ?? "" }),
          names && t("accounts.settings.captcha", { names }),
        ]
          .filter(Boolean)
          .join(" · "),
        r.failed ? "error" : "ok",
        r.challenged.length > 0 || r.failed > 0,
      );
      close();
    },
    onError: (e) => setError(friendly(asError(e))),
  });
  return (
    <Dialog open={ids !== null} onClose={() => !save.isPending && close()} title={t("accounts.settings.title")}>
      <form
        className="dlg-body flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (changes && valid.length) save.mutate();
        }}
      >
        <p className="text-fg-2">{t("accounts.settings.text", { count: valid.length })}</p>
        <Field label={t("accounts.settings.displayName")} hint={t("accounts.settings.displayNameHint")} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={name} placeholder="Farm {n}" maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        {ROWS.map((r) => (
          <div key={r.field} className="flex flex-col gap-1.5">
            <span className="label">{t(r.label)}</span>
            <Segmented
              label={t(r.label)}
              value={privacy[r.field]}
              options={CHOICES.map((c) => ({ value: c.value, label: t(c.label) }))}
              onChange={(v) => setPrivacy((p) => ({ ...p, [r.field]: v }))}
            />
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button size="md" disabled={save.isPending} onClick={close}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" size="md" icon="check" busy={save.isPending} disabled={!changes || !valid.length}>
            {save.isPending ? t("accounts.settings.saving") : t("accounts.settings.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
