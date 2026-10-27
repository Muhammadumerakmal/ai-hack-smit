"use client";

import { useState } from "react";
import { Avatar, FormSection, Meter, PIcon, Panel, SectionHeading, Skeleton, Surface, ToolButton, cx } from "@/components/people/kit";
import { Button, EmptyState, ErrorState, Field, Input, Notice, Select, StatusBadge, Tabs } from "@/components/ui";
import { CameraCheckIn } from "@/components/attendance/CameraCheckIn";
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
  faceCheckIn: { enrolled: boolean; enrolledAt: string | null };
  attendance: {
    counts: { present: number; late: number; half_day: number; missing_checkout: number; absent: number; on_leave: number };
    attendanceRatePct: number | null;
    latePct: number | null;
  };
  leaveBalance: { type: string; name: string; quota: number | null; usedApproved: number; pending: number; remaining: number | null }[];
  leaves: { id: string; type: string; start: string; end: string; days: number; status: string; reason: string }[];
  payslips: { id: string; month: string; status: string; gross: number; net: number }[];
}

type Tab = "overview" | "attendance" | "leave" | "payroll";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

/** Employee 360 (#07). HR may edit everything (#06, #14); the employee may edit own phone and address. */
export function Employee360({ id, mode }: { id: string; mode: "hr" | "self" | "view" }) {
  const { data, error, loading, reload } = useApi<Employee360Data>(`/api/employees/${id}`);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <ProfileSkeleton />;
  if (!data) return null;
  const p = data.profile;

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <Surface className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-teal-600/90 via-teal-500/70 to-teal-400/40 sm:h-24 dark:from-teal-900 dark:via-teal-800/70 dark:to-zinc-900" />
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-10 flex flex-col gap-4 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <span className="rounded-full ring-4 ring-white dark:ring-zinc-950">
                <Avatar name={p.fullName} size="xl" />
              </span>
              <div className="min-w-0 pb-1">
                <h2 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{p.fullName}</h2>
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                  {p.designation ?? "No designation"} · {p.department}
                </p>
              </div>
            </div>
            {mode !== "view" && (
              <div className="sm:pb-1">
                <ToolButton icon="edit" onClick={() => setEditing(true)}>
                  {mode === "hr" ? "Edit details" : "Edit contact details"}
                </ToolButton>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{p.code}</span>
            <StatusBadge status={p.status} />
            {p.role === "HR" && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300">HR</span>
            )}
            {!p.loginActive && <StatusBadge status="deactivated" />}
          </div>

          <ul className="mt-4 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Contact icon="mail" href={`mailto:${p.email}`} value={p.email} />
            <Contact icon="phone" href={p.phone ? `tel:${p.phone}` : undefined} value={p.phone} empty="No phone" />
            <Contact icon="pin" value={p.address} empty="No address" />
            <Contact icon="calendar" value={`Joined ${fmtDate(p.joinDate)}${p.exitDate ? ` · left ${fmtDate(p.exitDate)}` : ""}`} />
          </ul>
        </div>
      </Surface>

      <div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "attendance", label: "Attendance" },
            { id: "leave", label: "Leave" },
            { id: "payroll", label: "Payroll" },
          ]}
        />
        {tab === "overview" && <Overview data={data} mode={mode} onChanged={reload} />}
        {tab === "attendance" && <AttendanceTab data={data} />}
        {tab === "leave" && <LeaveTab data={data} />}
        {tab === "payroll" && <PayrollTab data={data} />}
      </div>

      {editing && mode === "hr" && <HrEdit data={data} onClose={() => setEditing(false)} onSaved={reload} />}
      {editing && mode === "self" && <SelfEdit data={data} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}

function Contact({ icon, value, href, empty = "—" }: { icon: string; value: string | null | undefined; href?: string; empty?: string }) {
  const content = value ? <span className="truncate">{value}</span> : <span className="text-zinc-500 dark:text-zinc-400">{empty}</span>;
  return (
    <li className="flex min-w-0 items-center gap-2 text-zinc-700 dark:text-zinc-300">
      <PIcon name={icon} className="h-4 w-4 shrink-0 text-zinc-400" />
      {href && value ? (
        <a href={href} className="min-w-0 truncate hover:text-teal-700 hover:underline dark:hover:text-teal-400">
          {value}
        </a>
      ) : (
        content
      )}
    </li>
  );
}

// ---------- Tabs ----------

function Overview({ data, mode, onChanged }: { data: Employee360Data; mode: "hr" | "self" | "view"; onChanged: () => void }) {
  const p = data.profile;
  const a = data.attendance;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Surface className="p-5 xl:col-span-2">
        <SectionHeading title="Employment details" icon="briefcase" />
        <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <Item k="Employee code" v={p.code} mono />
          <Item k="Department" v={p.department} />
          <Item k="Designation" v={p.designation} />
          <Item k="Employment status" v={cap(p.status.toLowerCase())} />
          <Item k="Join date" v={fmtDate(p.joinDate)} />
          <Item k="Exit date" v={p.exitDate ? fmtDate(p.exitDate) : "Currently employed"} />
          <Item k="Gender" v={cap(p.gender)} />
          <Item k="Login" v={p.loginActive ? "Active" : "Deactivated"} />
        </dl>
      </Surface>

      <SalaryCard salary={data.salary} />

      <Surface className="p-5 xl:col-span-2">
        <SectionHeading title="This month at a glance" hint="Working days so far this month." icon="clock" />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Attendance" value={a.attendanceRatePct == null ? "—" : `${a.attendanceRatePct}%`} tone="good" />
          <MiniStat label="Present" value={a.counts.present + a.counts.late + a.counts.missing_checkout} />
          <MiniStat label="Late" value={a.counts.late} tone={a.counts.late ? "warn" : "default"} />
          <MiniStat label="Absent" value={a.counts.absent} tone={a.counts.absent ? "bad" : "default"} />
        </div>
      </Surface>

      <Surface className="p-5">
        <SectionHeading title="Leave remaining" icon="leaf" />
        <LeaveMeters balances={data.leaveBalance} compact />
      </Surface>

      <FaceCard face={data.faceCheckIn} name={data.profile.fullName} employeeId={data.profile.id} mode={mode} onChanged={onChanged} />
    </div>
  );
}

/** Camera check-in face matching (extra bonus): the employee enrols once; HR can reset it. Admin only sees the status. */
function FaceCard({
  face,
  name,
  employeeId,
  mode,
  onChanged,
}: {
  face: Employee360Data["faceCheckIn"];
  name: string;
  employeeId: string;
  mode: "hr" | "self" | "view";
  onChanged: () => void;
}) {
  const [enrolling, setEnrolling] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function reset() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/employees/${employeeId}/face`, { method: "DELETE" });
      setConfirmReset(false);
      setMsg({ tone: "success", text: `${name}'s face was removed. They can enrol again from their profile.` });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const who = mode === "self" ? "your" : `${name.split(" ")[0]}'s`;
  return (
    <Surface className="p-5 xl:col-span-3">
      <SectionHeading
        title="Face check-in"
        icon="shield"
        hint={`Camera check-ins are matched to ${who} enrolled face. Stored as a face descriptor (128 numbers), never a photo.`}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {face.enrolled ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden />
              Face enrolled on {fmtDate(face.enrolledAt)}
              {mode === "self" && <span className="text-zinc-500 dark:text-zinc-400">· ask HR to reset it if you need to enrol again</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" aria-hidden />
              No face enrolled{mode === "self" ? ". Camera check-ins check for a live face but cannot tell it is you." : "."}
            </span>
          )}
        </p>
        {mode === "self" && !face.enrolled && <Button onClick={() => setEnrolling(true)}>Enrol my face</Button>}
        {mode === "hr" && face.enrolled && !confirmReset && (
          <Button variant="secondary" onClick={() => setConfirmReset(true)}>
            Reset face
          </Button>
        )}
        {mode === "hr" && confirmReset && (
          <span className="flex items-center gap-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Remove the enrolled face?</span>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={reset}>
              Reset
            </Button>
          </span>
        )}
      </div>
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {enrolling && (
        <CameraCheckIn
          mode="enroll"
          onClose={() => setEnrolling(false)}
          onDone={() => {
            setEnrolling(false);
            setMsg({ tone: "success", text: "Your face is enrolled. Your next camera check-in will be matched to it." });
            onChanged();
          }}
        />
      )}
    </Surface>
  );
}

function AttendanceTab({ data }: { data: Employee360Data }) {
  const c = data.attendance.counts;
  const a = data.attendance;
  return (
    <Surface className="p-5">
      <SectionHeading title="Attendance this month" hint="Counts are working days from the 1st of the month until today, using the company's attendance rules." icon="clock" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Attendance rate" value={a.attendanceRatePct == null ? "—" : `${a.attendanceRatePct}%`} tone="good" />
        <MiniStat label="Late %" value={a.latePct == null ? "—" : `${a.latePct}%`} tone={a.latePct ? "warn" : "default"} />
        <MiniStat label="Present" value={c.present} />
        <MiniStat label="Late" value={c.late} tone={c.late ? "warn" : "default"} />
        <MiniStat label="Half day" value={c.half_day} tone={c.half_day ? "warn" : "default"} />
        <MiniStat label="Missing check-out" value={c.missing_checkout} tone={c.missing_checkout ? "warn" : "default"} />
        <MiniStat label="Absent" value={c.absent} tone={c.absent ? "bad" : "default"} />
        <MiniStat label="On leave" value={c.on_leave} />
      </div>
    </Surface>
  );
}

function LeaveTab({ data }: { data: Employee360Data }) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Surface className="p-5">
        <SectionHeading title="Balance this year" hint="Approved leave is deducted; pending is shown separately." icon="leaf" />
        <LeaveMeters balances={data.leaveBalance} />
      </Surface>
      <Surface className="overflow-hidden xl:col-span-2">
        <div className="p-5 pb-4">
          <SectionHeading title="Recent leave requests" icon="calendar" />
        </div>
        {data.leaves.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title="No leave requests yet" />
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-200/80 dark:divide-zinc-800/70 dark:border-zinc-800/80">
            {data.leaves.map((l) => (
              <li key={l.id} className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {l.type} leave · {l.days} day{l.days === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {fmtDate(l.start)}
                    {l.end !== l.start ? ` – ${fmtDate(l.end)}` : ""}
                    {l.reason ? ` · ${l.reason}` : ""}
                  </p>
                </div>
                <StatusBadge status={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

function PayrollTab({ data }: { data: Employee360Data }) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <SalaryCard salary={data.salary} />
      <Surface className="overflow-hidden xl:col-span-2">
        <div className="p-5 pb-4">
          <SectionHeading title="Payslips" icon="file" />
        </div>
        {data.payslips.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title="No payslips yet" hint="Payslips appear here after a payroll run." />
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-200/80 dark:divide-zinc-800/70 dark:border-zinc-800/80">
            {data.payslips.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{monthLabel(s.month)}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Gross {money(s.gross)} · Net <span className="font-medium text-zinc-700 dark:text-zinc-300">{money(s.net)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={s.status} />
                  <a
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    href={`/api/payslips/${s.id}/pdf`}
                  >
                    <PIcon name="download" className="h-3.5 w-3.5" />
                    PDF
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

// ---------- Pieces ----------

function SalaryCard({ salary }: { salary: Employee360Data["salary"] }) {
  return (
    <Surface className="p-5">
      <SectionHeading title="Salary structure" hint="Monthly, per company policy." icon="wallet" />
      <dl className="mt-5 space-y-2.5 text-sm">
        <Line k="Basic" v={money(salary.basic)} />
        <Line k="House rent (40%)" v={money(salary.hra)} />
        <Line k="Medical (10%)" v={money(salary.medical)} />
      </dl>
      <div className="mt-4 flex items-baseline justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Gross</span>
        <span className="text-xl font-semibold tabular-nums text-teal-700 dark:text-teal-400">{money(salary.gross)}</span>
      </div>
    </Surface>
  );
}

function LeaveMeters({ balances, compact }: { balances: Employee360Data["leaveBalance"]; compact?: boolean }) {
  if (!balances.length) return <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">No leave types configured.</p>;
  return (
    <ul className={cx("mt-5", compact ? "space-y-3.5" : "space-y-4")}>
      {balances.map((b) => (
        <li key={b.type}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{b.name}</span>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
              {b.remaining == null ? (
                "Unlimited"
              ) : (
                <>
                  <b className="font-semibold text-zinc-900 dark:text-zinc-100">{b.remaining}</b> of {b.quota} left
                </>
              )}
            </span>
          </div>
          {b.quota != null && (
            <div className="mt-1.5">
              <Meter value={b.usedApproved} max={b.quota} tone={b.remaining != null && b.remaining <= 1 ? "amber" : "teal"} />
            </div>
          )}
          {!compact && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {b.usedApproved} used{b.pending ? ` · ${b.pending} pending approval` : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Item({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{k}</dt>
      <dd className={cx("mt-1 truncate text-zinc-900 dark:text-zinc-100", mono && "font-mono text-[13px]")}>{v || <span className="text-zinc-500 dark:text-zinc-400">Not set</span>}</dd>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
      <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{v}</dd>
    </div>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const c = { default: "text-zinc-900 dark:text-zinc-50", good: "text-teal-700 dark:text-teal-400", warn: "text-amber-600 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" }[tone];
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 px-3.5 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/40">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={cx("mt-1.5 text-xl font-semibold tabular-nums", c)}>{value}</p>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading profile">
      <Surface className="overflow-hidden">
        <Skeleton className="h-20 rounded-none sm:h-24" />
        <div className="flex items-end gap-4 px-6 pb-6">
          <Skeleton className="-mt-10 h-20 w-20 rounded-full" />
          <div className="flex-1 space-y-2 pb-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
      </Surface>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-56 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </div>
  );
}

// ---------- Editing ----------

function SelfEdit({ data, onClose, onSaved }: { data: Employee360Data; onClose: () => void; onSaved: () => void }) {
  const [phone, setPhone] = useState(data.profile.phone ?? "");
  const [address, setAddress] = useState(data.profile.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/employees/${data.profile.id}`, { method: "PATCH", body: { phone: phone || null, address: address || null } });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Panel
      open
      size="sm"
      title="Edit contact details"
      description="You can update your phone and address. Other details are managed by HR."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="self-edit" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="self-edit" onSubmit={save} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Phone">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
        </Field>
      </form>
    </Panel>
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
  const basic = Number(f.basicSalary);

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Panel
      open
      variant="drawer"
      size="lg"
      title={`Edit ${p.fullName}`}
      description={`${p.code} · changes are recorded in the audit log.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="hr-edit" loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="hr-edit" onSubmit={save} className="space-y-6">
        {error && <Notice tone="error">{error}</Notice>}
        <FormSection title="Personal">
          <Field label="Full name">
            <Input required minLength={2} value={f.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="Work email" hint="Also their login.">
            <Input required type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={set("gender")}>
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={f.address} onChange={set("address")} />
          </Field>
        </FormSection>

        <FormSection title="Job">
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
              <option value="">Not set</option>
              {desigs.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employment status">
            <Select value={f.status} onChange={set("status")}>
              {["PROBATION", "ACTIVE", "INACTIVE", "EXITED"].map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Join date">
            <Input type="date" value={f.joinDate} onChange={set("joinDate")} />
          </Field>
          <Field label="Exit date" hint="Leave empty while employed.">
            <Input type="date" value={f.exitDate} onChange={set("exitDate")} />
          </Field>
        </FormSection>

        <FormSection title="Salary" hint="Gross = 1.5 × basic (HRA 40%, medical 10%).">
          <Field label="Basic salary (PKR / month)">
            <Input type="number" min={1} inputMode="numeric" value={f.basicSalary} onChange={set("basicSalary")} />
          </Field>
          <div className="flex flex-col justify-end rounded-xl border border-zinc-200 bg-zinc-50/70 px-3.5 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">New gross</span>
            <span className="text-lg font-semibold tabular-nums text-teal-700 dark:text-teal-400">{basic > 0 ? money(basic * 1.5) : "—"}</span>
          </div>
        </FormSection>
      </form>
    </Panel>
  );
}
