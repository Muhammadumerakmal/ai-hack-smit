"use client";

import { useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Badge, Button, Card, EmptyState, ErrorState, Field, FieldErrors, Input, Loading, Modal, Notice, PageHeader, Select, Table, Tabs, Td } from "@/components/ui";
import { api, fieldErrorsOf, fmtDate, useApi } from "@/lib/client";

type Tab = "company" | "departments" | "designations" | "leave" | "holidays";

export default function SettingsPage() {
  const me = useMe();
  const canEdit = me.role === "ADMIN";
  const [tab, setTab] = useState<Tab>("company");
  return (
    <>
      <PageHeader title="Company setup" subtitle={canEdit ? "Rules here apply to new records only." : "View only. Ask the Admin to change these."} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "company", label: "Company & office" },
          { id: "departments", label: "Departments" },
          { id: "designations", label: "Designations" },
          { id: "leave", label: "Leave types" },
          { id: "holidays", label: "Holidays" },
        ]}
      />
      {tab === "company" && <CompanyTab canEdit={canEdit} />}
      {tab === "departments" && <NamedListTab kind="departments" label="department" canEdit={canEdit} />}
      {tab === "designations" && <NamedListTab kind="designations" label="designation" canEdit={canEdit} />}
      {tab === "leave" && <LeaveTypesTab canEdit={canEdit} />}
      {tab === "holidays" && <HolidaysTab canEdit={canEdit} />}
    </>
  );
}

interface Company {
  companyName: string;
  officeStart: string;
  graceMinutes: number;
  halfDayHours: number;
  weekendDays: number[];
  officeLat: number | null;
  officeLng: number | null;
  radiusMeters: number;
  latePenaltyEnabled: boolean;
  cameraRequired: boolean;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CompanyTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useApi<Company>("/api/org/settings");
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  return <CompanyForm initial={data} canEdit={canEdit} onSaved={reload} />;
}

function CompanyForm({ initial, canEdit, onSaved }: { initial: Company; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState<Company>(initial);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  /** Admin standing in the office: fill the office pin from this device's GPS. */
  function fillMyLocation() {
    if (!("geolocation" in navigator)) {
      setMsg({ tone: "error", text: "This browser cannot share its location. Type the coordinates instead." });
      return;
    }
    setLocating(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setF((cur) => ({ ...cur, officeLat: Number(p.coords.latitude.toFixed(6)), officeLng: Number(p.coords.longitude.toFixed(6)) }));
        setMsg({ tone: "success", text: `Location filled in (±${Math.round(p.coords.accuracy)} m). Press Save settings to keep it.` });
      },
      (err) => {
        setLocating(false);
        setMsg({ tone: "error", text: err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Your location could not be read. Type the coordinates instead." });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  const num = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      setFieldErrs({});
      await api("/api/org/settings", { method: "PUT", body: f });
      setMsg({ tone: "success", text: "Saved. New check-ins and leave use these rules." });
      onSaved();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
      setFieldErrs(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <FieldErrors errors={fieldErrs}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {msg && (
          <div className="sm:col-span-2">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
        <Field name="companyName" label="Company name" className="sm:col-span-2">
          <Input disabled={!canEdit} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
        </Field>
        <Field name="officeStart" label="Office start (24h)">
          <Input disabled={!canEdit} type="time" value={f.officeStart} onChange={(e) => setF({ ...f, officeStart: e.target.value })} />
        </Field>
        <Field name="graceMinutes" label="Grace time (minutes)" hint="Check-in after start + grace is late">
          <Input disabled={!canEdit} type="number" min={0} value={f.graceMinutes} onChange={num("graceMinutes")} />
        </Field>
        <Field name="halfDayHours" label="Half day under (hours)">
          <Input disabled={!canEdit} type="number" step="0.5" min={1} value={f.halfDayHours} onChange={num("halfDayHours")} />
        </Field>
        <Field name="weekendDays" label="Weekend">
          <div className="flex flex-wrap gap-2 pt-1">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={f.weekendDays.includes(i)}
                  onChange={(e) => setF({ ...f, weekendDays: e.target.checked ? [...f.weekendDays, i] : f.weekendDays.filter((x) => x !== i) })}
                />
                {d}
              </label>
            ))}
          </div>
        </Field>
        <Field name="officeLat" label="Office latitude" hint="For camera check-in geofence">
          <Input disabled={!canEdit} type="number" step="any" value={f.officeLat ?? ""} onChange={num("officeLat")} />
        </Field>
        <Field name="officeLng" label="Office longitude">
          <Input disabled={!canEdit} type="number" step="any" value={f.officeLng ?? ""} onChange={num("officeLng")} />
        </Field>
        <Field name="radiusMeters" label="Allowed radius (metres)">
          <Input disabled={!canEdit} type="number" min={20} value={f.radiusMeters} onChange={num("radiusMeters")} />
        </Field>
        {canEdit && (
          <div className="flex items-end">
            <Button type="button" variant="secondary" onClick={fillMyLocation} loading={locating}>
              Use my current location
            </Button>
          </div>
        )}
        <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 sm:col-span-2 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">Optional rules</legend>
          <Toggle
            disabled={!canEdit}
            checked={f.cameraRequired}
            onChange={(v) => setF({ ...f, cameraRequired: v })}
            label="Require camera check-in"
            hint="Employees must check in with one face, a blink and a location inside the radius. The plain web button is turned off. Needs the office location above."
          />
          <Toggle
            disabled={!canEdit}
            checked={f.latePenaltyEnabled}
            onChange={(v) => setF({ ...f, latePenaltyEnabled: v })}
            label="Late penalty: 3 lates = half a day"
            hint="Every 3 late days in a month deduct half a day of pay in that month's payroll. Shown on the payslip."
          />
        </fieldset>
        {canEdit && (
          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" loading={busy}>
              Save settings
            </Button>
          </div>
        )}
      </form>
      </FieldErrors>
    </Card>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-70" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      </span>
    </label>
  );
}

function NamedListTab({ kind, label, canEdit }: { kind: "departments" | "designations"; label: string; canEdit: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: { id: string; name: string; employees: number }[] }>(`/api/org/${kind}`);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    }
  }

  return (
    <Card>
      {canEdit && (
        <form
          className="mb-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api(`/api/org/${kind}`, { body: { name } }))) setName("");
          }}
        >
          <Input placeholder={`New ${label} name`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          <Button type="submit">Add</Button>
        </form>
      )}
      {msg && (
        <div className="mb-3">
          <Notice tone="error">{msg}</Notice>
        </div>
      )}
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <EmptyState title={`No ${kind} yet`} hint={canEdit ? `Add the first ${label} above.` : undefined} />
      ) : (
        <Table head={["Name", "Employees", ""]}>
          {data.items.map((d) => (
            <tr key={d.id}>
              <Td>{d.name}</Td>
              <Td>{d.employees}</Td>
              <Td className="text-right">
                {canEdit && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ id: d.id, name: d.name })}>
                      Rename
                    </Button>
                    <Button size="sm" variant="ghost" disabled={d.employees > 0} title={d.employees ? "In use" : undefined} onClick={() => act(() => api(`/api/org/${kind}/${d.id}`, { method: "DELETE" }))}>
                      Delete
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <Modal
          open
          title={`Rename ${label}`}
          onClose={() => setEditing(null)}
          footer={
            <Button
              onClick={async () => {
                if (await act(() => api(`/api/org/${kind}/${editing.id}`, { method: "PATCH", body: { name: editing.name } }))) setEditing(null);
              }}
            >
              Save
            </Button>
          }
        >
          <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        </Modal>
      )}
    </Card>
  );
}

interface LeaveType {
  id: string;
  code: string;
  name: string;
  yearlyQuota: number | null;
  isPaid: boolean;
}

function LeaveTypesTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: LeaveType[] }>("/api/org/leave-types");
  const [editing, setEditing] = useState<Partial<LeaveType> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setMsg(null);
    const body = { code: editing.code, name: editing.name, yearlyQuota: editing.yearlyQuota ?? null, isPaid: editing.isPaid ?? true };
    try {
      await api(editing.id ? `/api/org/leave-types/${editing.id}` : "/api/org/leave-types", { method: editing.id ? "PATCH" : "POST", body });
      setEditing(null);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <Card actions={canEdit && <Button size="sm" onClick={() => setEditing({ isPaid: true, yearlyQuota: 10 })}>Add leave type</Button>} title="Leave types and yearly quotas">
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <Table head={["Name", "Code", "Quota / year", "Paid", ""]}>
          {data?.items.map((t) => (
            <tr key={t.id}>
              <Td>{t.name}</Td>
              <Td className="font-mono text-xs">{t.code}</Td>
              <Td>{t.yearlyQuota ?? "Unlimited"}</Td>
              <Td>{t.isPaid ? <Badge color="green">paid</Badge> : <Badge color="amber">unpaid</Badge>}</Td>
              <Td className="text-right">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <Modal open title={editing.id ? "Edit leave type" : "Add leave type"} onClose={() => setEditing(null)} footer={<Button onClick={save}>Save</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {msg && (
              <div className="sm:col-span-2">
                <Notice tone="error">{msg}</Notice>
              </div>
            )}
            <Field label="Name">
              <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Code" hint="lowercase, e.g. casual">
              <Input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            </Field>
            <Field label="Days per year" hint="Empty = unlimited">
              <Input
                type="number"
                min={0}
                value={editing.yearlyQuota ?? ""}
                onChange={(e) => setEditing({ ...editing, yearlyQuota: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Paid">
              <Select value={editing.isPaid === false ? "no" : "yes"} onChange={(e) => setEditing({ ...editing, isPaid: e.target.value === "yes" })}>
                <option value="yes">Paid</option>
                <option value="no">Unpaid (deducted from salary)</option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function HolidaysTab({ canEdit }: { canEdit: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, loading, reload } = useApi<{ items: { id: string; date: string; name: string }[] }>(`/api/org/holidays?year=${year}`);
  const [f, setF] = useState({ date: "", name: "" });
  const [msg, setMsg] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    }
  }

  return (
    <Card
      title="Public holidays"
      actions={
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label="Year">
          {[year - 1, year, year + 1].map((y) => (
            <option key={y}>{y}</option>
          ))}
        </Select>
      }
    >
      {canEdit && (
        <form
          className="mb-4 grid gap-2 sm:grid-cols-[160px_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api("/api/org/holidays", { body: f }))) setF({ date: "", name: "" });
          }}
        >
          <Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
          <Input required minLength={2} placeholder="Holiday name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Button type="submit">Add</Button>
        </form>
      )}
      {msg && (
        <div className="mb-3">
          <Notice tone="error">{msg}</Notice>
        </div>
      )}
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <EmptyState title={`No holidays for ${year}`} hint="Leave and attendance skip these days." />
      ) : (
        <Table head={["Date", "Name", ""]}>
          {data.items.map((h) => (
            <tr key={h.id}>
              <Td>{fmtDate(h.date)}</Td>
              <Td>{h.name}</Td>
              <Td className="text-right">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/org/holidays/${h.id}`, { method: "DELETE" }))}>
                    Remove
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
