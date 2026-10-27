"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/shell/AuthCard";
import { Button, Field, FieldErrors, Input, Loading, Notice } from "@/components/ui";
import { api, fieldErrorsOf } from "@/lib/client";

// Create your company (#01): company name + its Admin account. Open to every visitor; each company is separate.
// On a brand-new install the Admin may come from ADMIN_EMAIL / ADMIN_PASSWORD in the env file.
export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ needsSetup: boolean; adminFromEnv: boolean } | null>(null);
  const [form, setForm] = useState({ companyName: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needsSetup: boolean; adminFromEnv: boolean }>("/api/setup")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrs({});
    try {
      const useEnv = status?.adminFromEnv && !form.adminEmail;
      await api("/api/setup", { body: useEnv ? { companyName: form.companyName, adminName: form.adminName } : form });
      router.replace("/settings");
    } catch (err) {
      setError((err as Error).message);
      setFieldErrs(fieldErrorsOf(err));
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <AuthCard title="Create your company">
        {error ? <Notice tone="error">{error}</Notice> : <Loading />}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your company"
      subtitle="You'll be its Admin. Your company is private: only the people you add can sign in to it. Next you add departments, then HR logins, and HR registers employees."
    >
      <FieldErrors errors={fieldErrs}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field name="companyName" label="Company name">
          <Input required minLength={2} value={form.companyName} onChange={set("companyName")} placeholder="e.g. Acme Corp" />
        </Field>
        <Field name="adminName" label="Your name (Admin)">
          <Input required minLength={2} value={form.adminName} onChange={set("adminName")} />
        </Field>
        {status.adminFromEnv && <Notice>Admin email and password can come from ADMIN_EMAIL / ADMIN_PASSWORD. Leave them blank to use those.</Notice>}
        <Field name="adminEmail" label="Admin email">
          <Input type="email" required={!status.adminFromEnv} autoComplete="username" value={form.adminEmail} onChange={set("adminEmail")} />
        </Field>
        <Field name="adminPassword" label="Admin password" hint="At least 8 characters, with a letter and a number.">
          <Input type="password" required={!status.adminFromEnv} minLength={8} autoComplete="new-password" value={form.adminPassword} onChange={set("adminPassword")} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Create company
        </Button>
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Sign in
          </Link>
        </p>
      </form>
      </FieldErrors>
    </AuthCard>
  );
}
