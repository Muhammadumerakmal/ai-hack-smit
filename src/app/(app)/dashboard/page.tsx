"use client";

import Link from "next/link";
import { useState } from "react";
import { AiSummaryCard } from "@/components/ai/AiSummaryCard";
import { CheckInWidget } from "@/components/attendance/CheckInWidget";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Select, Stat, Table, Td } from "@/components/ui";
import { fmtDate, fmtDateTime, money, qs, useApi } from "@/lib/client";

// M7 dashboards: Admin / HR company view with filters, Employee personal view. All numbers come from /api/dashboard.

interface Announcement {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
}
interface DeptRates {
  department: string;
  attendanceRatePct: number | null;
  latePct: number | null;
  absenteeismPct: number | null;
}
interface CompanyDashboard {
  kind: "company";
  role: "ADMIN" | "HR";
  departments: string[];
  kpis: {
    headcount: { total: number; active: number; probation: number; byDepartment: { department: string; count: number }[] };
    today: { present: number; late: number; onLeave: number; notCheckedIn: number };
    attendance: { attendanceRatePct: number | null; latePct: number | null; absenteeismPct: number | null; byDepartment: DeptRates[] };
    topLateComers: { name: string; department: string; lateCount: number }[];
    leave: { approvedDaysByType: { type: string; days: number; utilizationPct: number | null }[]; onLeaveToday: number };
    approvals: { pendingLeave: number; pendingAttendanceCorrections: number; total: number };
    attrition?: { exits: number; attritionPct: number | null };
  };
  trend: { date: string; attendanceRatePct: number }[];
  leaveUtilization: { department: string; type: string; days: number; utilizationPct: number | null }[];
  announcements: Announcement[];
  admin?: {
    payrollCost:
      | { found: false; message: string }
      | {
          found: true;
          month: string;
          status: string;
          totalGross: number;
          totalNet: number;
          averageGross: number;
          byDepartment: { name: string; gross: number; net: number; averageGross: number }[];
          byDesignation: { name: string; averageGross: number }[];
        };
    workforce: { gender: { label: string; count: number }[]; tenure: { label: string; count: number }[] };
    auditFeed: { id: string; createdAt: string; actorName: string; action: string; entity: string }[];
  };
}
interface PersonalDashboard {
  kind: "personal";
  week: { hours: number; target: number; pctOfTarget: number | null };
  month: { lateCount: number; attendanceRatePct: number | null };
  leaveBalance: { type: string; name: string; quota: number | null; usedApproved: number; pending: number; remaining: number | null }[];
  lastPayslip: { id: string; month: string; gross: number; net: number } | null;
  announcements: Announcement[];
}

const pctText = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

export default function DashboardPage() {
  const me = useMe();
  return me.role === "EMPLOYEE" ? <PersonalView /> : <CompanyView />;
}

function CompanyView() {
  const me = useMe();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const [draft, setDraft] = useState({ start: `${today.slice(0, 7)}-01`, end: today, department: "" });
  const [filters, setFilters] = useState(draft);
  const { data, error, loading, reload } = useApi<CompanyDashboard>(`/api/dashboard${qs(filters)}`);

  return (
    <>
      <PageHeader title={me.role === "ADMIN" ? "Company dashboard" : "HR dashboard"} subtitle={`${me.companyName} · all numbers are computed from the records in the app`} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <Field label="From">
          <Input type="date" value={draft.start} max={draft.end} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
        </Field>
        <Field label="To">
          <Input type="date" value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
        </Field>
        <Field label="Department">
          <Select value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })}>
            <option value="">All departments</option>
            {data?.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Button type="submit">Apply</Button>
      </form>

      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Headcount" value={data.kpis.headcount.total} hint={`${data.kpis.headcount.probation} on probation`} />
            <Stat label="Present today" value={data.kpis.today.present} tone="good" hint={`${data.kpis.today.notCheckedIn} not checked in`} />
            <Stat label="On leave today" value={data.kpis.today.onLeave} />
            <Stat label="Late today" value={data.kpis.today.late} tone={data.kpis.today.late ? "warn" : "default"} />
            <Stat
              label="Pending approvals"
              value={data.kpis.approvals.total}
              tone={data.kpis.approvals.total ? "warn" : "default"}
              hint={`${data.kpis.approvals.pendingLeave} leave · ${data.kpis.approvals.pendingAttendanceCorrections} corrections`}
            />
          </div>

          {data.admin && <AdminKpis d={data} />}

          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Attendance rate" value={pctText(data.kpis.attendance.attendanceRatePct)} tone="good" />
            <Stat label="Late %" value={pctText(data.kpis.attendance.latePct)} tone="warn" />
            <Stat label="Absenteeism" value={pctText(data.kpis.attendance.absenteeismPct)} tone="bad" />
          </div>

          <AiSummaryCard filters={{ start: filters.start, end: filters.end, department: filters.department || undefined }} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Attendance trend (daily rate)">
              {data.trend.length ? (
                <BarList items={data.trend.map((p) => ({ label: fmtDate(p.date), value: p.attendanceRatePct }))} max={100} suffix="%" />
              ) : (
                <EmptyState title="No attendance yet" hint="Daily rates appear once employees check in." />
              )}
            </Card>
            <Card title="Absenteeism by department">
              {data.kpis.attendance.byDepartment.length ? (
                <BarList items={data.kpis.attendance.byDepartment.map((d) => ({ label: d.department, value: d.absenteeismPct ?? 0 }))} suffix="%" tone="bad" />
              ) : (
                <EmptyState title="No attendance records in this period" />
              )}
            </Card>
            <Card title="Leave by type (approved days)">
              <BarList items={data.kpis.leave.approvedDaysByType.map((t) => ({ label: t.type, value: t.days, note: t.utilizationPct == null ? "unlimited" : `${t.utilizationPct}% of quota` }))} />
            </Card>
            <Card title="Top 5 late-comers">
              {data.kpis.topLateComers.length ? (
                <Table head={["Employee", "Department", "Late days"]}>
                  {data.kpis.topLateComers.map((l) => (
                    <tr key={l.name}>
                      <Td>{l.name}</Td>
                      <Td>{l.department}</Td>
                      <Td className="tabular-nums">{l.lateCount}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <EmptyState title="Nobody was late in this period" />
              )}
            </Card>
            <Card title="Headcount by department">
              <BarList items={data.kpis.headcount.byDepartment.map((d) => ({ label: d.department, value: d.count }))} />
            </Card>
            <Card title="Leave utilization (approved ÷ quota)">
              {data.leaveUtilization.some((u) => u.days) ? (
                <Table head={["Department", "Type", "Days", "Utilization"]}>
                  {data.leaveUtilization
                    .filter((u) => u.days)
                    .map((u) => (
                      <tr key={`${u.department}-${u.type}`}>
                        <Td>{u.department}</Td>
                        <Td>{u.type}</Td>
                        <Td className="tabular-nums">{u.days}</Td>
                        <Td className="tabular-nums">{pctText(u.utilizationPct)}</Td>
                      </tr>
                    ))}
                </Table>
              ) : (
                <EmptyState title="No approved leave in this period" />
              )}
            </Card>
          </div>

          {data.admin && <AdminCharts d={data} />}

          <Announcements items={data.announcements} />
        </div>
      )}
    </>
  );
}

function AdminKpis({ d }: { d: CompanyDashboard }) {
  const p = d.admin!.payrollCost;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Attrition (YTD)" value={pctText(d.kpis.attrition?.attritionPct)} hint={`${d.kpis.attrition?.exits ?? 0} exits`} />
      <Stat label="Payroll cost (gross)" value={p.found ? money(p.totalGross) : "—"} hint={p.found ? `${p.month} · ${p.status.toLowerCase()}` : p.message} />
      <Stat label="Payroll cost (net)" value={p.found ? money(p.totalNet) : "—"} />
      <Stat label="Average salary (gross)" value={p.found ? money(p.averageGross) : "—"} />
    </div>
  );
}

function AdminCharts({ d }: { d: CompanyDashboard }) {
  const a = d.admin!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Payroll cost by department${a.payrollCost.found ? ` (${a.payrollCost.month})` : ""}`}>
        {a.payrollCost.found ? (
          <BarList items={a.payrollCost.byDepartment.map((x) => ({ label: x.name, value: x.gross, note: `net ${money(x.net)}` }))} format={money} />
        ) : (
          <EmptyState title="No payroll run yet" />
        )}
      </Card>
      <Card title="Average gross salary by designation">
        {a.payrollCost.found ? <BarList items={a.payrollCost.byDesignation.map((x) => ({ label: x.name, value: x.averageGross }))} format={money} /> : <EmptyState title="No payroll run yet" />}
      </Card>
      <Card title="Gender">
        <BarList items={a.workforce.gender.map((g) => ({ label: g.label, value: g.count }))} />
      </Card>
      <Card title="Tenure">
        <BarList items={a.workforce.tenure.map((t) => ({ label: t.label, value: t.count }))} />
      </Card>
      <Card
        title="Recent activity (audit)"
        className="lg:col-span-2"
        actions={
          <Link href="/audit" className="text-xs text-teal-700 hover:underline dark:text-teal-400">
            Full audit log →
          </Link>
        }
      >
        {a.auditFeed.length ? (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {a.auditFeed.map((x) => (
              <li key={x.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  <span className="font-medium">{x.actorName || "—"}</span> {x.action.replace(/_/g, " ")} {x.entity.replace(/_/g, " ")}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">{fmtDateTime(x.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No activity yet" />
        )}
      </Card>
    </div>
  );
}

function PersonalView() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<PersonalDashboard>("/api/dashboard");
  return (
    <>
      <PageHeader title={`Hello, ${me.name.split(" ")[0]}`} subtitle="Your attendance, leave and pay at a glance." />
      <div className="space-y-6">
        <CheckInWidget onChange={reload} />
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !data && <Loading />}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Hours this week" value={`${data.week.hours} h`} hint={`of ${data.week.target} h (${pctText(data.week.pctOfTarget)})`} />
              <Stat label="Late this month" value={data.month.lateCount} tone={data.month.lateCount ? "warn" : "good"} />
              <Stat label="Attendance this month" value={pctText(data.month.attendanceRatePct)} tone="good" />
              <Stat
                label="Last payslip (net)"
                value={data.lastPayslip ? money(data.lastPayslip.net) : "—"}
                hint={data.lastPayslip ? data.lastPayslip.month : "No payslip yet"}
              />
            </div>
            <Card
              title="Leave balance"
              actions={
                <Link href="/leave" className="text-xs text-teal-700 hover:underline dark:text-teal-400">
                  Apply for leave →
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {data.leaveBalance.map((b) => (
                  <div key={b.type} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                    <p className="text-xs text-zinc-500">{b.name}</p>
                    <p className="text-lg font-semibold tabular-nums">{b.remaining == null ? "∞" : b.remaining}</p>
                    <p className="text-[11px] text-zinc-500">
                      {b.quota == null ? "unlimited" : `of ${b.quota}`} · {b.usedApproved} used{b.pending ? ` · ${b.pending} pending` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
            <Announcements items={data.announcements} />
            <p className="text-sm text-zinc-500">Questions about your leave, attendance or company policy? Ask the assistant (✦ button, bottom right).</p>
          </>
        )}
      </div>
    </>
  );
}

function Announcements({ items }: { items: Announcement[] }) {
  return (
    <Card
      title="Announcements"
      actions={
        <Link href="/announcements" className="text-xs text-teal-700 hover:underline dark:text-teal-400">
          All →
        </Link>
      }
    >
      {items.length ? (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id}>
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.body}</p>
              <p className="text-[11px] text-zinc-400">
                {a.authorName} · {fmtDateTime(a.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No announcements" />
      )}
    </Card>
  );
}

/** Plain horizontal bars: label, bar, value. Enough for every chart on this page. */
function BarList({
  items,
  max,
  suffix = "",
  format,
  tone = "teal",
}: {
  items: { label: string; value: number; note?: string }[];
  max?: number;
  suffix?: string;
  format?: (n: number) => string;
  tone?: "teal" | "bad";
}) {
  if (!items.length) return <EmptyState title="No data for this period" />;
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-zinc-600 dark:text-zinc-400" title={i.label}>
            {i.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
            <span className={`block h-full rounded ${tone === "bad" ? "bg-red-500" : "bg-teal-600"}`} style={{ width: `${Math.min(100, (i.value / top) * 100)}%` }} />
          </span>
          <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
            {format ? format(i.value) : `${i.value}${suffix}`}
            {i.note && <span className="ml-1 text-zinc-400">({i.note})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
