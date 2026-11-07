import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, asError, type AccountSummary } from "../../api";
import { t } from "../../i18n";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";
import { friendly, toast } from "../../ui/Toast";

/** Join group: the chosen signed-in accounts join one group, pasted as a link or its number. */
export function JoinGroupDialog({ ids, accounts, onClose }: { ids: number[] | null; accounts: AccountSummary[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = (ids ?? []).filter((id) => accounts.find((a) => a.id === id)?.status === "valid");
  const name = (id: number) => accounts.find((a) => a.id === id)?.username;
  const join = useMutation({
    mutationFn: () => api.accountsJoinGroup(valid, text),
    onSuccess: (r) => {
      const names = r.challenged.map(name).filter(Boolean).join(", ");
      toast(
        [
          t("accounts.toast.joinedGroup", { count: r.joined }),
          r.already && t("accounts.toast.alreadyInGroup", { count: r.already }),
          r.failed && t("accounts.toast.joinGroupFailed", { count: r.failed, why: r.firstError ?? "" }),
          names && t("accounts.toast.joinGroupCaptcha", { names }),
        ]
          .filter(Boolean)
          .join(" · "),
        r.failed ? "error" : "ok",
        r.challenged.length > 0 || r.failed > 0,
      );
      setText("");
      onClose();
    },
    onError: (e) => setError(friendly(asError(e))),
  });
  return (
    <Dialog open={ids !== null} onClose={() => !join.isPending && onClose()} title={t("accounts.joinGroupTitle")}>
      <form
        className="dlg-body flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (text.trim() && valid.length) join.mutate();
        }}
      >
        <p className="text-fg-2">{t("accounts.joinGroupText", { count: valid.length })}</p>
        <Field label={t("accounts.joinGroupLabel")} hint={t("accounts.joinGroupHint")} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} leading="globe" value={text} placeholder="roblox.com/communities/1234567" autoFocus onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button size="md" disabled={join.isPending} onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" size="md" icon="accounts" busy={join.isPending} disabled={!text.trim() || !valid.length}>
            {join.isPending ? t("accounts.joiningGroup") : t("accounts.joinGroup")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
