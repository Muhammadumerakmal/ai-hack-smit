"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/shell/AuthCard";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/setup")
      .then((s) => s.needsSetup && router.replace("/setup"))
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ mustChangePassword: boolean }>("/api/auth/login", { body: { email, password } });
      router.replace(r.mustChangePassword ? "/change-password" : "/dashboard");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in" subtitle="Use your own email and password, or the temporary one your Admin or HR gave you.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <div className="relative py-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
          <span className="absolute inset-x-0 top-1/2 h-px bg-zinc-200 dark:bg-zinc-800" aria-hidden />
          <span className="relative bg-background px-2">New here?</span>
        </div>
        <Link
          href="/setup"
          className="flex h-10 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white text-sm font-medium text-zinc-800 shadow-sm shadow-zinc-900/5 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Create your company
        </Link>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">HR and employee logins are created inside a company by its Admin and HR.</p>
      </form>
    </AuthCard>
  );
}
