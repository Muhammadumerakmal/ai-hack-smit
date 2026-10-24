"use client";

import { useState } from "react";
import { Button, Card, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
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

// Admin only (#05): create HR logins, deactivate / reactivate, reset passwords, switch HR ⇄ Employee.
export default function UsersPage() {
  const { data, error, loading, reload } = useApi<{ items: UserRow[] }>("/api/users");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; tempPassword: string; title: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Users & logins" subtitle="HR logins are created here. Employee logins are created when HR registers an employee." actions={<Button onClick={() => setCreating(true)}>Create HR login</Button>} />
      {msg && (
        <div className="mb-3">
          <Notice tone="error">{msg}</Notice>
        </div>
      )}
      <Card>
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : (
          <Table head={["Name", "Role", "Status", "Created", ""]}>
            {data?.items.map((u) => (
              <tr key={u.id}>
                <Td>
                  <p className="font-medium">{u.name || "—"}</p>
                  <p className="text-xs text-zinc-500">
                    {u.email}
                    {u.employee && ` · ${u.employee.code}`}
                  </p>
                </Td>
                <Td>{u.role}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={u.isActive ? "active" : "deactivated"} />
                    {u.mustChangePassword && <StatusBadge status="temp password" />}
                  </div>
                </Td>
                <Td>{fmtDate(u.createdAt)}</Td>
                <Td className="text-right">
                  {u.role !== "ADMIN" && (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { isActive: !u.isActive } }))}>
                        {u.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(async () => {
                            const r = await api<{ email: string; tempPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
                            setSecret({ ...r, title: "Password reset" });
                          })
                        }
                      >
                        Reset password
                      </Button>
                      {u.employee && (
                        <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { role: u.role === "HR" ? "EMPLOYEE" : "HR" } }))}>
                          {u.role === "HR" ? "Make employee" : "Make HR"}
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

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
      {secret && (
        <Modal open title={secret.title} onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
          <div className="space-y-3 text-sm">
            <p>
              Temporary password for <b>{secret.email}</b>. It is shown only once; they must change it at first sign-in.
            </p>
            <p className="rounded-lg bg-zinc-100 px-3 py-2 text-center font-mono text-lg tracking-wide dark:bg-zinc-900">{secret.tempPassword}</p>
          </div>
        </Modal>
      )}
    </>
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
    <Modal open title="Create HR login" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Name">
          <Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
