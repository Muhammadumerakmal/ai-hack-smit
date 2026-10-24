"use client";

import { useState } from "react";
import { Button, Card, ErrorState, Field, Input, Loading, Modal, Notice, Select, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { api, fmtDate, money, useApi } from "@/lib/client";

export interface Employee360Data {
  profile: {
    id: string;
    code: string;
    fullName: string;
    email: string;
    phone: string | null;
    address: string | null;
    gender: string | null;
    departmentId: string;
    department: string;
    designationId: string | null;
    designation: string | null;
    joinDate: string;
    exitDate: string | null;
    status: string;
    role: string | null;
    loginActive: boolean;
  };
  salary: { basic: number; hra: number; medical: number; gross: number };
  attendance: {
    counts: { present: number; late: number; half_day: number; missing_checkout: number; absent: number; on_leave: number };
    attendanceRatePct: number | null;
    latePct: number | null;
  };
  leaveBalance: { type: string; name: string; quota: number | null; usedApproved: number; pending: number; remaining: number | null }[];
  leaves: { id: string; type: string; start: string; end: string; days: number; status: string; reason: string }[];
  payslips: { id: string; month: string; status: string; gross: number; net: number }[];
}

/** Employee 360 (#07). HR may edit everything (#06, #14); the employee may edit own phone and address. */
export function Employee360({ id, mode }: { id: string; mode: "hr" | "self" | "view" }) {
  const { data, error, loading, reload } = useApi<Employee360Data>(`/api/employees/${id}`);
  const [editing, setEditing] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const p = data.profile;
  const a = data.attendance;

  return (
    <div className="space-y-4">
      <Card
        title={`${p.fullName} · ${p.code}`}
        actions={
          mode !== "view" && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {mode === "hr" ? "Edit details" : "Edit phone & address"}
            </Button>
          )
        }
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Item k="Email" v={p.email} />
          <Item k="Phone" v={p.phone} />
          <Item k="Address" v={p.address} />
          <Item k="Department" v={p.department} />
          <Item k="Designation" v={p.designation} />
          <Item k="Gender" v={p.gender} />
          <Item k="Joined" v={fmtDate(p.joinDate)} />
          <Item k="Exit date" v={p.exitDate ? fmtDate(p.exitDate) : null} />
          <div>
            <dt className="text-xs text-zinc-500">Status</dt>
            <dd className="mt-0.5 flex gap-1">
              <StatusBadge status={p.status} />
              {!p.loginActive && <StatusBadge status="deactivated" />}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Basic" value={money(data.salary.basic)} />
        <Stat label="HRA (40%)" value={money(data.salary.hra)} />
        <Stat label="Medical (10%)" value={money(data.salary.medical)} />
        <Stat label="Gross (1.5 × basic)" value={money(data.salary.gross)} tone="good" />
      </div>

      <Card title="Attendance this month">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Attendance rate" value={a.attendanceRatePct == null ? "—" : `${a.attendanceRatePct}%`} />
          <Stat label="Present" value={a.counts.present + a.counts.late + a.counts.missing_checkout} />
          <Stat label="Late" value={a.counts.late} tone={a.counts.late ? "warn" : "default"} />
          <Stat label="Absent" value={a.counts.absent} tone={a.counts.absent ? "bad" : "default"} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Leave balance">
          <Table head={["Type", "Quota", "Used", "Pending", "Left"]}>
            {data.leaveBalance.map((b) => (
              <tr key={b.type}>
                <Td>{b.name}</Td>
                <Td>{b.quota ?? "∞"}</Td>
                <Td>{b.usedApproved}</Td>
                <Td>{b.pending}</Td>
                <Td className="font-medium">{b.remaining ?? "∞"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Payslips">
          {data.payslips.length === 0 ? (
            <p className="text-sm text-zinc-500">No payslips yet.</p>
          ) : (
            <Table head={["Month", "Status", "Gross", "Net", ""]}>
              {data.payslips.map((s) => (
                <tr key={s.id}>
                  <Td>{s.month}</Td>
                  <Td>
                    <StatusBadge status={s.status} />
                  </Td>
                  <Td>{money(s.gross)}</Td>
                  <Td>{money(s.net)}</Td>
                  <Td>
                    <a className="text-xs text-teal-700 hover:underline dark:text-teal-400" href={`/api/payslips/${s.id}/pdf`}>
                      PDF
                    </a>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Recent leave">
        {data.leaves.length === 0 ? (
          <p className="text-sm text-zinc-500">No leave requests.</p>
        ) : (
          <Table head={["Type", "From", "To", "Days", "Status", "Reason"]}>
            {data.leaves.map((l) => (
              <tr key={l.id}>
                <Td>{l.type}</Td>
                <Td>{fmtDate(l.start)}</Td>
                <Td>{fmtDate(l.end)}</Td>
                <Td>{l.days}</Td>
                <Td>
                  <StatusBadge status={l.status} />
                </Td>
                <Td className="text-zinc-600 dark:text-zinc-400">{l.reason}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editing && mode === "hr" && <HrEdit data={data} onClose={() => setEditing(false)} onSaved={reload} />}
      {editing && mode === "self" && <SelfEdit data={data} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{k}</dt>
      <dd className="mt-0.5">{v || "—"}</dd>
    </div>
  );
}

function SelfEdit({ data, onClose, onSaved }: { data: Employee360Data; onClose: () => void; onSaved: () => void }) {
  const [phone, setPhone] = useState(data.profile.phone ?? "");
  const [address, setAddress] = useState(data.profile.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/employees/${data.profile.id}`, { method: "PATCH", body: { phone: phone || null, address: address || null } });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Edit contact details"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}

interface Option {
  id: string;
  name: string;
}

function HrEdit({ data, onClose, onSaved }: { data: Employee360Data; onClose: () => void; onSaved: () => void }) {
  const p = data.profile;
  const depts = useApi<{ items: Option[] }>("/api/org/departments");
  const desigs = useApi<{ items: Option[] }>("/api/org/designations");
  const [f, setF] = useState({
    fullName: p.fullName,
    email: p.email,
    phone: p.phone ?? "",
    address: p.address ?? "",
    gender: p.gender ?? "",
    departmentId: p.departmentId,
    designationId: p.designationId ?? "",
    joinDate: p.joinDate,
    status: p.status,
    exitDate: p.exitDate ?? "",
    basicSalary: String(data.salary.basic),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/employees/${p.id}`, {
        method: "PATCH",
        body: {
          ...f,
          phone: f.phone || null,
          address: f.address || null,
          gender: f.gender || null,
          designationId: f.designationId || null,
          exitDate: f.exitDate || null,
          basicSalary: Number(f.basicSalary),
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Edit ${p.fullName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <Field label="Full name">
          <Input value={f.fullName} onChange={set("fullName")} />
        </Field>
        <Field label="Email (login)">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="Address">
          <Input value={f.address} onChange={set("address")} />
        </Field>
        <Field label="Department">
          <Select value={f.departmentId} onChange={set("departmentId")}>
            {depts.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Designation">
          <Select value={f.designationId} onChange={set("designationId")}>
            <option value="">—</option>
            {desigs.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender">
          <Select value={f.gender} onChange={set("gender")}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            {["PROBATION", "ACTIVE", "INACTIVE", "EXITED"].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Join date">
          <Input type="date" value={f.joinDate} onChange={set("joinDate")} />
        </Field>
        <Field label="Exit date" hint="Leave empty while employed">
          <Input type="date" value={f.exitDate} onChange={set("exitDate")} />
        </Field>
        <Field label="Basic salary (PKR / month)" hint="Gross = 1.5 × basic (HRA 40%, medical 10%)">
          <Input type="number" min={1} value={f.basicSalary} onChange={set("basicSalary")} />
        </Field>
      </div>
    </Modal>
  );
}
