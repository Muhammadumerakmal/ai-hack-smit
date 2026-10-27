"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AiSummaryCard } from "@/components/ai/AiSummaryCard";
import { CheckInWidget } from "@/components/attendance/CheckInWidget";
import { AnnouncementFeed, type Announcement } from "@/components/dashboard/AnnouncementFeed";
import { BarChart, DataTable, RankedList, TrendChart, type BarItem } from "@/components/dashboard/charts";
import { FilterBar, rangeLabel, todayIsoLocal, type Filters } from "@/components/dashboard/FilterBar";
import { Avatar, cx, DashboardSkeleton, DIcon, Kpi, LinkArrow, Meter, Panel, Skeleton, timeAgo, ViewToggle } from "@/components/dashboard/primitives";
import { useMe } from "@/components/shell/AppShell";
import { labelCase } from "@/components/ops/format";
import { EmptyState, ErrorState } from "@/components/ui";
import { money, qs, useApi } from "@/lib/client";

// M7 dashboards: Admin / HR company view with filters, Employee personal view. All numbers come from /api/dashboard.

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
  insights: Insights;
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
    payrollTrend: { month: string; status: string; employees: number; totalGross: number; totalNet: number }[];
    workforce: { gender: { label: string; count: number }[]; tenure: { label: string; count: number }[] };
    auditFeed: { id: string; createdAt: string; actorName: string; action: string; entity: string }[];
  };
}
type RiskLevel = "high" | "medium" | "low";
interface Insights {
  attritionRisk: {
    window: { start: string; end: string };
    scored: number;
    counts: Record<RiskLevel, number>;
    employees: { employeeId: string; name: string; department: string; score: number; level: RiskLevel; factors: { factor: string; points: number; detail: string }[] }[];
  };
  anomalies: {
    total: number;
    employeesFlagged: number;
    flags: { employeeId: string; name: string; department: string; kind: string; severity: "high" | "medium"; detail: string }[];
  };
}
interface WeekDay {
  date: string;
  hours: number;
  weekend: boolean;
  future: boolean;
}
interface PersonalDashboard {
  kind: "personal";
  week: { end: string; hours: number; target: number; pctOfTarget: number | null; days: WeekDay[] };
  month: { lateCount: number; attendanceRatePct: number | null };
  leaveBalance: { type: string; name: string; quota: number | null; usedApproved: number; pending: number; remaining: number | null }[];
  lastPayslip: { id: string; month: string; gross: number; net: number } | null;
  announcements: Announcement[];
}

const pctText = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function DashboardPage() {
  const me = useMe();
  return me.role === "EMPLOYEE" ? <PersonalView /> : <CompanyView />;
}

function PageTitle({ title, context, actions }: { title: string; context: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.7rem]">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{context}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A chart panel with a Chart/Table switch, so every value is reachable without hovering. */
function ChartPanel({
  title,
  subtitle,
  table,
  children,
  className,
  extra,
}: {
  title: string;
  subtitle?: string;
  table: { head: string[]; rows: (string | number)[][] } | null;
  children: ReactNode;
  className?: string;
  extra?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <>
          {extra}
          {table && table.rows.length > 0 && <ViewToggle value={view} onChange={setView} />}
        </>
      }
    >
      {view === "table" && table ? <DataTable head={table.head} rows={table.rows} /> : children}
    </Panel>
  );
}

function CompanyView() {
  const me = useMe();
  const today = todayIsoLocal();
  const [filters, setFilters] = useState<Filters>({ start: `${today.slice(0, 7)}-01`, end: today, department: "" });
  const { data, error, loading, reload } = useApi<CompanyDashboard>(`/api/dashboard${qs({ ...filters })}`);
  const refreshing = loading && !!data;

  return (
    <>
      <PageTitle
        title={me.role === "ADMIN" ? "Company dashboard" : "HR dashboard"}
        context={
          <>
            {me.companyName} · {rangeLabel(filters)} · {filters.department || "All departments"}
          </>
        }
        actions={
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <DIcon name="refresh" className={cx("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
        }
      />

      <FilterBar applied={filters} departments={data?.departments ?? []} onApply={setFilters} busy={loading} />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={reload} />
        </div>
      )}
      {!data && loading && <DashboardSkeleton />}

      {data && (
        <div className={cx("space-y-6 transition-opacity duration-300", refreshing && "opacity-60")} aria-busy={refreshing}>
          {/* Today */}
          <section aria-label="Today" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Headcount" icon="people" value={data.kpis.headcount.total} hint={`${data.kpis.headcount.active} active · ${data.kpis.headcount.probation} on probation`} />
            <Kpi label="Present today" icon="check" tone="good" value={data.kpis.today.present} hint={`${data.kpis.today.notCheckedIn} not checked in yet`} />
            <Kpi label="On leave today" icon="leave" tone="info" value={data.kpis.today.onLeave} hint="Approved leave covering today" />
            <Kpi label="Late today" icon="clock" tone={data.kpis.today.late ? "warn" : "default"} value={data.kpis.today.late} hint="Checked in after the grace time" />
            <Link
              href="/leave"
              className="col-span-2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 sm:col-span-1"
              aria-label={`Pending approvals: ${data.kpis.approvals.total}. Open the approval inbox.`}
            >
              <Kpi
                className="h-full transition-colors hover:border-teal-300 dark:hover:border-teal-800"
                label="Pending approvals"
                icon="inbox"
                tone={data.kpis.approvals.total ? "warn" : "default"}
                value={data.kpis.approvals.total}
                hint={`${plural(data.kpis.approvals.pendingLeave, "leave request")} · ${plural(data.kpis.approvals.pendingAttendanceCorrections, "correction")}`}
              />
            </Link>
          </section>

          {data.admin && <AdminKpis d={data} />}

          {/* Attendance health for the selected period */}
          <section aria-label="Attendance in this period" className="grid grid-cols-3 gap-3">
            <RateTile label="Attendance rate" value={data.kpis.attendance.attendanceRatePct} tone="good" />
            <RateTile label="Late %" value={data.kpis.attendance.latePct} tone="warn" />
            <RateTile label="Absenteeism" value={data.kpis.attendance.absenteeismPct} tone="bad" />
          </section>

          <AiSummaryCard filters={{ start: filters.start, end: filters.end, department: filters.department || undefined }} />

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartPanel
              className="lg:col-span-2"
              title="Attendance trend"
              subtitle="Daily attendance rate, working days only"
              table={{ head: ["Date", "Attendance"], rows: data.trend.map((p) => [p.date, `${p.attendanceRatePct}%`]) }}
            >
              {data.trend.length ? (
                <TrendChart label="Daily attendance rate" points={data.trend.map((p) => ({ date: p.date, value: p.attendanceRatePct }))} />
              ) : (
                <EmptyState title="No attendance yet" hint="Daily rates appear once employees start checking in." />
              )}
            </ChartPanel>
            <Panel title="Top late-comers" subtitle="Most late check-ins in this period">
              {data.kpis.topLateComers.length ? (
                <RankedList unit="late days" items={data.kpis.topLateComers.map((l) => ({ name: l.name, sub: l.department, value: l.lateCount }))} />
              ) : (
                <EmptyState title="Nobody was late" hint="Great punctuality in this period." />
              )}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartPanel
              title="Absenteeism by department"
              subtitle="Absent days ÷ expected working days"
              table={{ head: ["Department", "Absenteeism", "Late %", "Attendance"], rows: data.kpis.attendance.byDepartment.map((d) => [d.department, pctText(d.absenteeismPct), pctText(d.latePct), pctText(d.attendanceRatePct)]) }}
            >
              <BarChart
                items={data.kpis.attendance.byDepartment.map((d) => ({ label: d.department, value: d.absenteeismPct ?? 0 }))}
                max={Math.max(10, ...data.kpis.attendance.byDepartment.map((d) => d.absenteeismPct ?? 0))}
                format={(n) => `${n}%`}
                empty={<EmptyState title="No attendance records in this period" />}
              />
            </ChartPanel>
            <ChartPanel
              title="Leave by type"
              subtitle="Approved working days in this period"
              table={{ head: ["Type", "Days", "Of quota"], rows: data.kpis.leave.approvedDaysByType.map((t) => [t.type, t.days, t.utilizationPct == null ? "unlimited" : `${t.utilizationPct}%`]) }}
            >
              <BarChart
                items={data.kpis.leave.approvedDaysByType.map<BarItem>((t) => ({ label: t.type, value: t.days, note: t.utilizationPct == null ? "No quota" : `${t.utilizationPct}% of quota used` }))}
                format={(n) => plural(n, "day")}
                empty={<EmptyState title="No leave types yet" hint="Admin adds leave types in Company setup." />}
              />
            </ChartPanel>
            <ChartPanel
              className="md:col-span-2 xl:col-span-1"
              title="Headcount by department"
              subtitle="Active and probation on the end date"
              table={{ head: ["Department", "Employees"], rows: data.kpis.headcount.byDepartment.map((d) => [d.department, d.count]) }}
            >
              <BarChart
                items={data.kpis.headcount.byDepartment.map((d) => ({ label: d.department, value: d.count }))}
                empty={<EmptyState title="No employees yet" hint="HR registers employees from the Employees page." />}
              />
            </ChartPanel>
          </div>

          <InsightPanels insights={data.insights} />

          <UtilizationPanel rows={data.leaveUtilization} />

          {data.admin && <AdminCharts d={data} />}

          <Panel
            title="Announcements"
            subtitle="Latest company news"
            actions={
              <Link href="/announcements">
                <LinkArrow>All announcements</LinkArrow>
              </Link>
            }
          >
            {data.announcements.length ? <AnnouncementFeed items={data.announcements} compact /> : <EmptyState title="No announcements yet" />}
          </Panel>
        </div>
      )}
    </>
  );
}

function RateTile({ label, value, tone }: { label: string; value: number | null; tone: "good" | "warn" | "bad" }) {
  const bar = { good: "bg-teal-600", warn: "bg-amber-500", bad: "bg-red-500" }[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50">
      <p className="text-[11px] font-medium leading-tight text-zinc-500 sm:text-xs dark:text-zinc-400">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">{pctText(value)}</p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
        <div className={cx("h-full rounded-full", bar)} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </div>
    </div>
  );
}

const LEVEL_STYLE: Record<RiskLevel, string> = {
  high: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30",
  medium: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  low: "bg-zinc-50 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600/40",
};
const ANOMALY_LABEL: Record<string, string> = {
  consecutive_absence: "Absent days in a row",
  weekend_bridge: "Absences next to weekends",
  missing_checkouts: "Missing check-outs",
  absence_outlier: "Far above group absence",
};

/** Bonus insights: rule-based attrition risk and absence anomaly flags, each with its reasons. */
function InsightPanels({ insights }: { insights: Insights }) {
  const r = insights.attritionRisk;
  const atRisk = r.employees.filter((e) => e.level !== "low");
  const a = insights.anomalies;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Attrition risk"
        subtitle={`Last 90 days to ${r.window.end} · ${r.counts.high} high · ${r.counts.medium} medium`}
      >
        {atRisk.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {atRisk.slice(0, 6).map((e) => (
              <li key={e.employeeId} className="flex items-start gap-3 py-2.5">
                <Avatar name={e.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <Link href={`/employees/${e.employeeId}`} className="truncate text-sm font-medium hover:underline">
                      {e.name}
                    </Link>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{e.department}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{e.factors.slice(0, 2).map((f) => f.detail).join(" · ")}</p>
                </div>
                <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset", LEVEL_STYLE[e.level])}>
                  {e.score} <span className="font-medium capitalize">{e.level}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No one at elevated risk"
            hint={r.scored ? `${plural(r.scored, "employee")} scored low on absence, lateness, unpaid leave and tenure.` : "Scores appear after 5 working days of attendance history."}
          />
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Rule-based score out of 100: absenteeism 30 · lateness 20 · rising absence 20 · unpaid leave 15 · tenure under a year 15. High ≥ 60, medium ≥ 35.
        </p>
      </Panel>
      <Panel title="Absence anomalies" subtitle={a.total ? `${plural(a.total, "flag")} for ${plural(a.employeesFlagged, "employee")} in this period` : "Unusual absence patterns in this period"}>
        {a.flags.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {a.flags.slice(0, 8).map((f, i) => (
              <li key={`${f.employeeId}-${f.kind}-${i}`} className="flex items-start gap-3 py-2.5">
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", f.severity === "high" ? "bg-red-500" : "bg-amber-500")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-sm font-medium">
                      {f.name} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {f.department}</span>
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ANOMALY_LABEL[f.kind] ?? f.kind}
                      <span className="sr-only">, {f.severity} severity</span>
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No unusual absence patterns" hint="Checks: 3+ absent days in a row, absences next to weekends, missing check-outs, absence far above the group." />
        )}
      </Panel>
    </div>
  );
}

function UtilizationPanel({ rows }: { rows: CompanyDashboard["leaveUtilization"] }) {
  const used = rows.filter((u) => u.days);
  return (
    <Panel title="Leave utilization" subtitle="Approved days ÷ (yearly quota × headcount), by department and type">
      {!used.length ? (
        <EmptyState title="No approved leave in this period" />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
                  <th className="py-2.5 pr-3 font-medium">Department</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 text-right font-medium">Days</th>
                  <th className="py-2.5 pl-3 font-medium">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {used.map((u) => (
                  <tr key={`${u.department}-${u.type}`}>
                    <td className="py-2.5 pr-3 font-medium">{u.department}</td>
                    <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{labelCase(u.type)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.days}</td>
                    <td className="py-2.5 pl-3">
                      <UtilBar pct={u.utilizationPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 sm:hidden">
            {used.map((u) => (
              <li key={`${u.department}-${u.type}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{u.department}</span>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {labelCase(u.type)} · {plural(u.days, "day")}
                  </span>
                </div>
                <div className="mt-2">
                  <UtilBar pct={u.utilizationPct} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function UtilBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-zinc-500 dark:text-zinc-400">No quota</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-950" aria-hidden>
        <span className="block h-full rounded-full bg-teal-600" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-700 dark:text-zinc-300">{pct}%</span>
    </span>
  );
}

function AdminKpis({ d }: { d: CompanyDashboard }) {
  const p = d.admin!.payrollCost;
  return (
    <section aria-label="Company" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Attrition (YTD)" icon="exit" value={pctText(d.kpis.attrition?.attritionPct)} hint={`${plural(d.kpis.attrition?.exits ?? 0, "exit")} this year`} />
      <Kpi label="Payroll cost (gross)" icon="money" value={p.found ? money(p.totalGross) : "—"} hint={p.found ? `${monthLabel(p.month)} · ${p.status.toLowerCase()}` : p.message} />
      <Kpi label="Payroll cost (net)" icon="money" value={p.found ? money(p.totalNet) : "—"} hint={p.found ? "After deductions and tax" : "Run payroll to see costs"} />
      <Kpi label="Average salary (gross)" icon="trend" value={p.found ? money(p.averageGross) : "—"} hint={p.found ? "Mean gross per employee" : undefined} />
    </section>
  );
}

const ACTION_TONE: Record<string, string> = {
  create: "bg-teal-500",
  approve: "bg-teal-500",
  finalize: "bg-teal-500",
  update: "bg-sky-500",
  delete: "bg-red-500",
  reject: "bg-red-500",
  deactivate: "bg-red-500",
};

function AdminCharts({ d }: { d: CompanyDashboard }) {
  const a = d.admin!;
  const p = a.payrollCost;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartPanel
        className="md:col-span-2"
        title="Payroll cost by month"
        subtitle="Gross pay per monthly run, last 12 months"
        table={
          a.payrollTrend.length
            ? { head: ["Month", "Status", "Employees", "Gross", "Net"], rows: a.payrollTrend.map((r) => [monthLabel(r.month), r.status.toLowerCase(), r.employees, money(r.totalGross), money(r.totalNet)]) }
            : null
        }
      >
        {a.payrollTrend.length ? (
          <BarChart
            items={a.payrollTrend.map((r) => ({
              label: monthLabel(r.month),
              value: r.totalGross,
              note: `Net ${money(r.totalNet)}${r.status === "DRAFT" ? " · draft" : ""}`,
            }))}
            format={money}
          />
        ) : (
          <EmptyState title="No payroll runs yet" hint="Each month appears here once HR creates its payroll draft." />
        )}
      </ChartPanel>
      <ChartPanel
        title="Payroll cost by department"
        subtitle={p.found ? `Gross pay, ${monthLabel(p.month)}` : "Gross pay"}
        table={p.found ? { head: ["Department", "Gross", "Net"], rows: p.byDepartment.map((x) => [x.name, money(x.gross), money(x.net)]) } : null}
      >
        {p.found ? (
          <BarChart items={p.byDepartment.map((x) => ({ label: x.name, value: x.gross, note: `Net ${money(x.net)}` }))} format={money} />
        ) : (
          <EmptyState title="No payroll run yet" hint="HR creates the monthly draft on the Payroll page." />
        )}
      </ChartPanel>
      <ChartPanel
        title="Average salary by designation"
        subtitle="Mean gross pay"
        table={p.found ? { head: ["Designation", "Average gross"], rows: p.byDesignation.map((x) => [x.name, money(x.averageGross)]) } : null}
      >
        {p.found ? <BarChart items={p.byDesignation.map((x) => ({ label: x.name, value: x.averageGross }))} format={money} /> : <EmptyState title="No payroll run yet" />}
      </ChartPanel>
      <ChartPanel title="Gender" subtitle="Current headcount" table={{ head: ["Gender", "Employees"], rows: a.workforce.gender.map((g) => [g.label, g.count]) }}>
        <BarChart items={a.workforce.gender.map((g) => ({ label: g.label, value: g.count }))} empty={<EmptyState title="No employees yet" />} />
      </ChartPanel>
      <ChartPanel title="Tenure" subtitle="Time since joining" table={{ head: ["Tenure", "Employees"], rows: a.workforce.tenure.map((t) => [t.label, t.count]) }}>
        <BarChart items={a.workforce.tenure.map((t) => ({ label: t.label, value: t.count }))} empty={<EmptyState title="No employees yet" />} />
      </ChartPanel>
      <Panel
        className="md:col-span-2"
        title="Recent activity"
        subtitle="Latest entries in the audit log"
        actions={
          <Link href="/audit">
            <LinkArrow>Full audit log</LinkArrow>
          </Link>
        }
      >
        {a.auditFeed.length ? (
          <ol className="grid gap-x-8 sm:grid-cols-2">
            {a.auditFeed.map((x) => {
              const verb = x.action.split("_")[0];
              return (
                <li key={x.id} className="flex items-start gap-3 border-b border-zinc-100 py-2.5 last:border-0 dark:border-zinc-800 sm:[&:nth-last-child(2):nth-child(odd)]:border-0">
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", ACTION_TONE[verb] ?? "bg-zinc-400")} aria-hidden />
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{x.actorName || "System"}</span>{" "}
                    <span className="text-zinc-600 dark:text-zinc-300">
                      {x.action.replace(/_/g, " ")} · {x.entity.replace(/_/g, " ")}
                    </span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{timeAgo(x.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState title="No activity yet" />
        )}
      </Panel>
    </div>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Karachi" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Hours per day, Monday to Sunday. The scale is a 9 h day (or the longest day), so short days read as short. */
function WeekBars({ days, today }: { days: WeekDay[]; today: string }) {
  const max = Math.max(9, ...days.map((d) => d.hours));
  const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return (
    <figure className="border-t border-zinc-100 pt-4 dark:border-zinc-800/70">
      <figcaption className="sr-only">Hours worked each day this week</figcaption>
      <ol className="grid h-36 grid-cols-7 items-end gap-1.5">
        {days.map((d) => {
          const isToday = d.date === today;
          return (
            <li key={d.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5" aria-label={`${dayName(d.date)}: ${d.future ? "upcoming" : `${d.hours} hours`}`}>
              <span className={cx("text-[11px] tabular-nums", d.hours ? "font-medium text-zinc-700 dark:text-zinc-300" : "text-transparent")} aria-hidden>
                {d.hours}
              </span>
              <span className="flex w-full max-w-7 flex-1 items-end overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800/70" aria-hidden>
                <span
                  className={cx("w-full rounded-md", isToday ? "bg-teal-600 dark:bg-teal-400" : d.weekend ? "bg-teal-300/70 dark:bg-teal-700" : "bg-teal-500/80 dark:bg-teal-500/70")}
                  style={{ height: `${(d.hours / max) * 100}%` }}
                />
              </span>
              <span
                className={cx("text-[11px]", isToday ? "font-semibold text-teal-700 dark:text-teal-300" : d.weekend || d.future ? "text-zinc-500 dark:text-zinc-500" : "text-zinc-500 dark:text-zinc-400")}
                aria-hidden
              >
                {dayName(d.date).slice(0, 2)}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function PersonalView() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<PersonalDashboard>("/api/dashboard");
  const todayLong = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Karachi" });

  return (
    <>
      <PageTitle title={`${greeting()}, ${me.name.split(" ")[0]}`} context={`${todayLong} · your attendance, leave and pay at a glance`} />
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <CheckInWidget onChange={reload} />
          </div>
          <Panel title="This week" subtitle="Hours worked, Monday to today">
            {data ? (
              <div className="space-y-3">
                <p className="text-3xl font-semibold tracking-tight">
                  {data.week.hours}
                  <span className="ml-1 text-base font-medium text-zinc-500 dark:text-zinc-400">/ {data.week.target} h</span>
                </p>
                <Meter label="Hours this week against the weekly target" value={data.week.hours} max={data.week.target} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {data.week.pctOfTarget == null ? "No hours yet this week" : `${data.week.pctOfTarget}% of the ${data.week.target} h target`}
                </p>
                <WeekBars days={data.week.days} today={data.week.end} />
              </div>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-40" />
              </div>
            )}
          </Panel>
        </div>

        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !data && <DashboardSkeleton tiles={3} />}

        {data && (
          <>
            <section aria-label="This month" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Kpi label="Late this month" icon="clock" tone={data.month.lateCount ? "warn" : "good"} value={data.month.lateCount} hint={data.month.lateCount ? "Check-ins after the grace time" : "On time every day"} />
              <Kpi label="Attendance this month" icon="check" tone="good" value={pctText(data.month.attendanceRatePct)} hint="Present, late and half days count" />
              <Link href="/payslips" className="col-span-2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 lg:col-span-1" aria-label="Last payslip. Open payslips.">
                <Kpi
                  className="h-full transition-colors hover:border-teal-300 dark:hover:border-teal-800"
                  label="Last payslip (net)"
                  icon="doc"
                  value={data.lastPayslip ? money(data.lastPayslip.net) : "—"}
                  hint={data.lastPayslip ? `${monthLabel(data.lastPayslip.month)} · gross ${money(data.lastPayslip.gross)}` : "No payslip yet"}
                />
              </Link>
            </section>

            <Panel
              title="Leave balance"
              subtitle={`Days left this year`}
              actions={
                <Link href="/leave">
                  <LinkArrow>Apply for leave</LinkArrow>
                </Link>
              }
            >
              {data.leaveBalance.length ? (
                <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {data.leaveBalance.map((b) => (
                    <li key={b.type} className="rounded-xl border border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{b.name}</p>
                      <p className="mt-1 text-2xl font-semibold tracking-tight">
                        {b.remaining == null ? "∞" : b.remaining}
                        {b.quota != null && <span className="ml-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">/ {b.quota}</span>}
                      </p>
                      {b.quota != null && (
                        <div className="mt-2">
                          <Meter label={`${b.name} days left`} value={b.remaining ?? 0} max={b.quota} />
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {b.quota == null ? "No yearly limit" : `${b.usedApproved} used`}
                        {b.pending ? ` · ${b.pending} pending` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No leave types yet" />
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel
                className="lg:col-span-2"
                title="Announcements"
                actions={
                  <Link href="/announcements">
                    <LinkArrow>All</LinkArrow>
                  </Link>
                }
              >
                {data.announcements.length ? <AnnouncementFeed items={data.announcements} compact /> : <EmptyState title="No announcements yet" />}
              </Panel>
              <section className="flex flex-col justify-between gap-4 rounded-2xl border border-violet-200/70 bg-violet-50/60 p-5 dark:border-violet-900/50 dark:bg-violet-950/20">
                <div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600 text-white">
                    <DIcon name="sparkle" />
                  </span>
                  <h2 className="mt-3 text-sm font-semibold">Ask your assistant</h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    “How many sick leaves do I have left?” or “What time counts as late?” It answers from your own records and company policy.
                  </p>
                </div>
                <p className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300">
                  <Avatar name="AI" size="sm" />
                  Use the “Ask the assistant” button at the bottom right.
                </p>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
