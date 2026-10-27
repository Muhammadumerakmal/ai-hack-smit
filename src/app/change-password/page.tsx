"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/shell/AuthCard";
import { Button, Field, FieldErrors, Input, Notice } from "@/components/ui";
import { api, fieldErrorsOf } from "@/lib/client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [forced, setForced] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ mustChangePassword: boolean }>("/api/auth/me")
      .then((m) => setForced(m.mustChangePassword))
      .catch(() => router.replace("/login"));
  }, [router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError("The new passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/change-password", { body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setDone(true);
      setTimeout(() => router.replace("/dashboard"), 900);
    } catch (err) {
      setError((err as Error).message);
      setFieldErrs(fieldErrorsOf(err));
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={forced ? "Choose your own password" : "Change password"}
      subtitle={forced ? "You signed in with a temporary password. Set a new one to continue." : undefined}
    >
      <FieldErrors errors={fieldErrs}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {done && <Notice tone="success">Password changed. Taking you to your dashboard…</Notice>}
        <Field name="currentPassword" label={forced ? "Temporary password" : "Current password"}>
          <Input type="password" required autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} />
        </Field>
        <Field name="newPassword" label="New password" hint="At least 8 characters, with a letter and a number.">
          <Input type="password" required minLength={8} autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
        </Field>
        <Button type="submit" loading={busy} disabled={done} className="w-full">
          Save password
        </Button>
        {!forced && (
          <Button type="button" variant="ghost" className="w-full" onClick={() => router.back()}>
            Cancel
          </Button>
        )}
      </form>
      </FieldErrors>
    </AuthCard>
  );
}
