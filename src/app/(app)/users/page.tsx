"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionMenu, Avatar, PIcon, Panel, RowsSkeleton, SearchInput, SecretReveal, Surface, ToolButton, cx, type MenuItem } from "@/components/people/kit";
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { api, fmtDate, useApi } from "@/lib/client";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "HR" | "EMPLOYEE";
  isActive: boolean;
  mustChangePassword: boolean;
  employee: { id: string; code: string; fullName: string } | null;
  createdAt: string;
}

type Filter = "all" | "HR" | "EMPLOYEE" | "inactive";
type Confirm = { title: string; body: string; cta: string; tone: "primary" | "danger"; run: () => Promise<void> };

const ROLE_STYLE: Record<UserRow["role"], string> = {
  ADMIN: "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100",
  HR: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  EMPLOYEE: "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300",
};

function RoleBadge({ role }: { role: UserRow["role"] }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ROLE_STYLE[role])}>{role === "HR" ? "HR" : role.charAt(0) + role.slice(1).toLowerCase()}</span>;
}

// Admin only (#05): create HR logins, deactivate / reactivate, reset passwords, switch HR ⇄ Employee.
export default function UsersPage() {
  const { data, error, loading, reload } = useApi<{ items: UserRow[] }>("/api/users");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; tempPassword: string; title: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: items.length,
      HR: items.filter((u) => u.role === "HR").length,
      EMPLOYEE: items.filter((u) => u.role === "EMPLOYEE").length,
      inactive: items.filter((u) => !u.isActive).length,
      pending: items.filter((u) => u.mustChangePassword && u.isActive).length,
    }),
    [items],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (u) =>
        (filter === "all" || (filter === "inactive" ? !u.isActive : u.role === filter)) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.employee?.code.toLowerCase().includes(q) ?? false)),
    );
  }, [items, filter, search]);

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    await confirm.run();
    setBusy(false);
    setConfirm(null);
  }

  function menuFor(u: UserRow): MenuItem[] {
    const who = u.name || u.email;
    const items: MenuItem[] = [
      {
        label: "Reset password",
        icon: "key",
        onSelect: () =>
          setConfirm({
            title: "Reset password?",
            body: `${who} will get a new temporary password and must choose a new one at next sign-in.`,
            cta: "Reset password",
            tone: "primary",
            run: () =>
              act(async () => {
                const r = await api<{ email: string; tempPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
                setSecret({ ...r, title: "Password reset" });
              }),
          }),
      },
    ];
    if (u.employee) {
      items.push({
        label: u.role === "HR" ? "Change role to Employee" : "Change role to HR",
        icon: "shield",
        onSelect: () =>
          setConfirm({
            title: u.role === "HR" ? "Remove HR access?" : "Give HR access?",
            body: u.role === "HR" ? `${who} will lose access to HR screens and approvals.` : `${who} will be able to register employees, approve requests and run payroll drafts.`,
            cta: u.role === "HR" ? "Make employee" : "Make HR",
            tone: "primary",
            run: () => act(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { role: u.role === "HR" ? "EMPLOYEE" : "HR" } })),
          }),
      });
    }
    items.push({
      label: u.isActive ? "Deactivate login" : "Reactivate login",
      icon: u.isActive ? "lock" : "check",
      tone: u.isActive ? "danger" : "default",
      onSelect: () =>
        u.isActive
          ? setConfirm({
              title: "Deactivate this login?",
              body: `${who} will be signed out immediately and won't be able to sign in until reactivated. Their records are kept.`,
              cta: "Deactivate",
              tone: "danger",
              run: () => act(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { isActive: false } })),
            })
          : act(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { isActive: true } })),
    });
    return items;
  }

  const filters: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: "All", n: counts.all },
    { id: "HR", label: "HR", n: counts.HR },
    { id: "EMPLOYEE", label: "Employees", n: counts.EMPLOYEE },
    { id: "inactive", label: "Deactivated", n: counts.inactive },
  ];

  return (
    <>
      <PageHeader
        title="Users & logins"
        subtitle="Create HR logins here. Employee logins are created automatically when HR registers an employee."
        actions={
          <ToolButton icon="plus" variant="primary" onClick={() => setCreating(true)}>
            Create HR login
          </ToolButton>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total logins" value={counts.all} icon="users" />
        <Tile label="HR" value={counts.HR} icon="shield" />
        <Tile label="Awaiting first sign-in" value={counts.pending} icon="key" tone={counts.pending ? "warn" : "default"} />
        <Tile label="Deactivated" value={counts.inactive} icon="lock" tone={counts.inactive ? "bad" : "default"} />
      </div>

      {msg && (
        <div className="mb-4">
          <Notice tone="error">{msg}</Notice>
        </div>
      )}

      <Surface className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-zinc-200/80 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between dark:border-zinc-800/80">
          <div role="tablist" aria-label="Filter logins" className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            {filters.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cx(
                  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
                  filter === f.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200",
                )}
              >
                {f.label}
                <span className="rounded-full bg-zinc-200/80 px-1.5 text-[11px] tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">{f.n}</span>
              </button>
            ))}
          </div>
          <div className="lg:w-80">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or code" label="Search logins" />
          </div>
        </div>

        {error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <RowsSkeleton rows={5} />
        ) : shown.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No logins match" hint="Try another filter or search term." />
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400 dark:border-zinc-800/80 dark:bg-zinc-900/40">
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-3 py-3 font-medium">Role</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="hidden px-3 py-3 font-medium lg:table-cell">Created</th>
                    <th className="w-14 px-3 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {shown.map((u) => (
                    <tr key={u.id} className={cx("transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40", !u.isActive && "opacity-70")}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name || u.email} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{u.name || "—"}</p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {u.email}
                              {u.employee && (
                                <>
                                  {" · "}
                                  <Link href={`/employees/${u.employee.id}`} className="font-mono hover:text-teal-700 hover:underline dark:hover:text-teal-400">
                                    {u.employee.code}
                                  </Link>
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={u.isActive ? "active" : "deactivated"} />
                          {u.mustChangePassword && u.isActive && <StatusBadge status="temp password" />}
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3 text-zinc-600 lg:table-cell dark:text-zinc-400">{fmtDate(u.createdAt)}</td>
                      <td className="px-3 py-3 text-right">{u.role !== "ADMIN" ? <ActionMenu items={menuFor(u)} label={`Actions for ${u.name || u.email}`} /> : <span className="sr-only">No actions</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800/70">
              {shown.map((u) => (
                <li key={u.id} className={cx("flex items-start gap-3 px-4 py-3.5", !u.isActive && "opacity-70")}>
                  <Avatar name={u.name || u.email} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.name || "—"}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{u.email}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <RoleBadge role={u.role} />
                      <StatusBadge status={u.isActive ? "active" : "deactivated"} />
                      {u.mustChangePassword && u.isActive && <StatusBadge status="temp password" />}
                    </div>
                  </div>
                  {u.role !== "ADMIN" && <ActionMenu items={menuFor(u)} label={`Actions for ${u.name || u.email}`} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </Surface>

      {creating && (
        <CreateHr
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setSecret({ ...r, title: "HR login created" });
            reload();
          }}
        />
      )}

      {confirm && (
        <Panel
          open
          size="sm"
          title={confirm.title}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant={confirm.tone === "danger" ? "danger" : "primary"} loading={busy} onClick={runConfirm}>
                {confirm.cta}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{confirm.body}</p>
        </Panel>
      )}

      {secret && (
        <Panel open size="sm" title={secret.title} onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
          <SecretReveal email={secret.email} secret={secret.tempPassword} />
        </Panel>
      )}
    </>
  );
}

function Tile({ label, value, icon, tone = "default" }: { label: string; value: number; icon: string; tone?: "default" | "warn" | "bad" }) {
  const c = { default: "text-zinc-900 dark:text-zinc-50", warn: "text-amber-600 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" }[tone];
  return (
    <Surface className="flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        <PIcon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className={cx("text-xl font-semibold tabular-nums", c)}>{value}</p>
      </div>
    </Surface>
  );
}

function CreateHr({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { email: string; tempPassword: string }) => void }) {
  const [f, setF] = useState({ name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<{ email: string; tempPassword: string }>("/api/users", { body: f }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Panel
      open
      size="sm"
      title="Create HR login"
      description="You'll get a one-time temporary password to share with them."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-hr" loading={busy}>
            Create login
          </Button>
        </>
      }
    >
      <form id="create-hr" onSubmit={submit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Full name">
          <Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Work email" hint="They sign in with this email.">
          <Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
        </Field>
      </form>
    </Panel>
  );
}
