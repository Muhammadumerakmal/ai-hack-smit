"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/shell/AuthCard";
import { Button, Field, Input, Loading, Notice } from "@/components/ui";
import { api } from "@/lib/client";

// First-run setup (#01): company name + the Admin account (or ADMIN_EMAIL / ADMIN_PASSWORD from env).
export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ needsSetup: boolean; adminFromEnv: boolean } | null>(null);
  const [form, setForm] = useState({ companyName: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needsSetup: boolean; adminFromEnv: boolean }>("/api/setup")
      .then((s) => (s.needsSetup ? setStatus(s) : router.replace("/login")))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const useEnv = status?.adminFromEnv && !form.adminEmail;
      await api("/api/setup", { body: useEnv ? { companyName: form.companyName, adminName: form.adminName } : form });
      router.replace("/settings");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <AuthCard title="Setup">
        {error ? <Notice tone="error">{error}</Notice> : <Loading />}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Welcome! Set up your company" subtitle="This runs once. Next you will add departments, leave types and HR logins.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Company name">
          <Input required minLength={2} value={form.companyName} onChange={set("companyName")} placeholder="e.g. Saylani Tech" />
        </Field>
        <Field label="Your name (Admin)">
          <Input required minLength={2} value={form.adminName} onChange={set("adminName")} />
        </Field>
        {status.adminFromEnv && <Notice>Admin email and password can come from ADMIN_EMAIL / ADMIN_PASSWORD. Leave them blank to use those.</Notice>}
        <Field label="Admin email">
          <Input type="email" required={!status.adminFromEnv} autoComplete="username" value={form.adminEmail} onChange={set("adminEmail")} />
        </Field>
        <Field label="Admin password" hint="At least 8 characters, with a letter and a number.">
          <Input type="password" required={!status.adminFromEnv} minLength={8} autoComplete="new-password" value={form.adminPassword} onChange={set("adminPassword")} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Create company
        </Button>
      </form>
    </AuthCard>
  );
}
