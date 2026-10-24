import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, maxIso, minIso, monthRange, toDate, toIso, todayIso, weekdayOf, workingDays } from "@/lib/dates";
import { badRequest, forbidden } from "@/lib/errors";
import { assertRole, type Session } from "@/lib/session";
import { countRows, getAttendanceSummary, getDayRows, getLateComers, getTodaySnapshot, rates } from "./attendance.service";
import { latestAudit, listAnnouncements } from "./comms.service";
import { getHeadcount } from "./employee.service";
import { getLeaveBalance, getLeaveSummary } from "./leave.service";
import { getHolidaySet, getLeaveTypes, getSettings, resolveDepartmentId } from "./settings.service";

export interface DashboardFilters {
  start: string;
  end: string;
  department?: string;
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const money = (n: number) => Math.round(n * 100) / 100;
const deptWhere = (departmentId?: string): Prisma.EmployeeWhereInput => (departmentId ? { departmentId } : {});

/**
 * The KPI JSON behind the Admin / HR dashboards (Section 7).
 * The dashboard renders from this, and the AI summary reads exactly this object,
 * so the bullets can only quote numbers the user already sees.
 */
export async function getDashboardKpis(actor: Session, f: DashboardFilters) {
  assertRole(actor, "ADMIN", "HR");
  const departmentId = await resolveDepartmentId(f.department);

  const [headcount, today, attendance, late, leave, pendingCorrections] = await Promise.all([
    getHeadcount(actor, { department: f.department, asOf: f.end }),
    getTodaySnapshot(departmentId),
    getAttendanceSummary(actor, f),
    getLateComers(actor, { ...f, limit: 5 }),
    getLeaveSummary(actor, f),
    db.attendanceCorrection.count({ where: { status: "PENDING", ...(departmentId && { employee: { departmentId } }) } }),
  ]);

  const kpis = {
    filters: { period: `${f.start} to ${f.end}`, department: f.department ?? "all departments" },
    headcount: { total: headcount.total, active: headcount.active, probation: headcount.probation, byDepartment: headcount.byDepartment },
    today,
    attendance: {
      attendanceRatePct: attendance.attendanceRatePct,
      latePct: attendance.latePct,
      absenteeismPct: attendance.absenteeismPct,
      counts: attendance.counts,
      byDepartment: attendance.byDepartment,
    },
    topLateComers: late.lateComers.map((l) => ({ name: l.name, department: l.department, lateCount: l.lateCount })),
    leave: {
      pendingApprovals: leave.pendingRequests,
      approvedDaysByType: leave.approvedDaysByType,
      onLeaveToday: leave.onLeaveToday.count,
    },
    approvals: {
      pendingLeave: leave.pendingRequests,
      pendingAttendanceCorrections: pendingCorrections,
      total: leave.pendingRequests + pendingCorrections,
    },
  };

  if (actor.role !== "ADMIN") return kpis;

  // Admin dashboard extras: attrition (YTD) and payroll cost.
  const [attrition, payroll] = await Promise.all([
    getAttrition({ start: `${f.end.slice(0, 4)}-01-01`, end: f.end, departmentId }),
    getPayrollCost(f.end, departmentId),
  ]);
  return {
    ...kpis,
    attrition,
    payroll: payroll.found
      ? { month: payroll.month, status: payroll.status, totalGross: payroll.totalGross, totalNet: payroll.totalNet, averageGross: payroll.averageGross }
      : { message: "No payroll run yet" },
  };
}

// ---------- building blocks ----------

/** Employees on the books on a date, by dates (join ≤ date < exit). Used for historical headcount in attrition. */
async function headcountOn(asOf: string, departmentId?: string) {
  return db.employee.count({
    where: {
      status: { not: "INACTIVE" },
      joinDate: { lte: toDate(asOf) },
      OR: [{ exitDate: null }, { exitDate: { gt: toDate(asOf) } }],
      ...deptWhere(departmentId),
    },
  });
}

/** Section 7: exits in period ÷ average headcount (mean of start and end) × 100. */
export async function getAttrition(f: { start: string; end: string; departmentId?: string }) {
  const [exits, startCount, endCount] = await Promise.all([
    db.employee.count({ where: { exitDate: { gte: toDate(f.start), lte: toDate(f.end) }, ...deptWhere(f.departmentId) } }),
    headcountOn(f.start, f.departmentId),
    headcountOn(f.end, f.departmentId),
  ]);
  const averageHeadcount = (startCount + endCount) / 2;
  return { period: `${f.start} to ${f.end}`, exits, averageHeadcount, attritionPct: pct(exits, averageHeadcount) };
}

/** Daily attendance rate over the period (one point per working day up to today). */
export async function getAttendanceTrend(f: { start: string; end: string; departmentId?: string }) {
  const rows = await getDayRows({ start: f.start, end: f.end, departmentId: f.departmentId });
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => {
      const c = countRows(r);
      return { date, attendanceRatePct: rates(c).attendanceRatePct, present: c.present + c.late + c.half_day + c.missing_checkout, absent: c.absent, onLeave: c.on_leave };
    })
    .filter((p) => p.attendanceRatePct !== null);
}

/** Section 7: approved leave days ÷ (yearly quota × headcount), per leave type and department, within the period. */
export async function getLeaveUtilization(f: { start: string; end: string; departmentId?: string }) {
  const [settings, holidays, types, approved, staff] = await Promise.all([
    getSettings(),
    getHolidaySet(f.start, f.end),
    getLeaveTypes(),
    db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: toDate(f.end) }, endDate: { gte: toDate(f.start) }, employee: deptWhere(f.departmentId) },
      include: { employee: { include: { department: true } }, leaveType: true },
    }),
    db.employee.groupBy({ by: ["departmentId"], where: { status: { in: ["ACTIVE", "PROBATION"] }, ...deptWhere(f.departmentId) }, _count: { _all: true } }),
  ]);
  const depts = await db.department.findMany({ where: { id: { in: staff.map((s) => s.departmentId) } } });
  const headByDept = new Map(staff.map((s) => [depts.find((d) => d.id === s.departmentId)?.name ?? "?", s._count._all]));

  const days = new Map<string, number>(); // "dept|type" → days
  for (const l of approved) {
    const n = workingDays(maxIso(f.start, toIso(l.startDate)), minIso(f.end, toIso(l.endDate)), settings.weekendDays, holidays).length;
    const key = `${l.employee.department.name}|${l.leaveType.code}`;
    days.set(key, (days.get(key) ?? 0) + n);
  }

  const out: { department: string; type: string; days: number; utilizationPct: number | null }[] = [];
  for (const [department, headcount] of headByDept) {
    for (const t of types) {
      const d = days.get(`${department}|${t.code}`) ?? 0;
      out.push({ department, type: t.code, days: d, utilizationPct: t.yearlyQuota ? pct(d, t.yearlyQuota * headcount) : null });
    }
  }
  return out.sort((a, b) => a.department.localeCompare(b.department) || a.type.localeCompare(b.type));
}

/** Payroll cost from the latest run at or before the period end: gross/net by department, mean gross by department and designation. */
export async function getPayrollCost(end: string, departmentId?: string) {
  const run = await db.payrollRun.findFirst({ where: { month: { lte: end.slice(0, 7) } }, orderBy: { month: "desc" } });
  if (!run) return { found: false as const, message: "No payroll run yet" };

  const slips = await db.payslip.findMany({
    where: { runId: run.id, ...(departmentId && { employee: { departmentId } }) },
    include: { employee: { include: { department: true, designation: true } } },
  });
  const group = (key: (s: (typeof slips)[number]) => string) => {
    const m = new Map<string, { employees: number; gross: number; net: number }>();
    for (const s of slips) {
      const g = m.get(key(s)) ?? { employees: 0, gross: 0, net: 0 };
      g.employees++;
      g.gross += Number(s.gross);
      g.net += Number(s.net);
      m.set(key(s), g);
    }
    return [...m.entries()].map(([name, g]) => ({ name, employees: g.employees, gross: money(g.gross), net: money(g.net), averageGross: money(g.gross / g.employees) }));
  };
  const totalGross = slips.reduce((n, s) => n + Number(s.gross), 0);
  return {
    found: true as const,
    month: run.month,
    status: run.status,
    employees: slips.length,
    totalGross: money(totalGross),
    totalNet: money(slips.reduce((n, s) => n + Number(s.net), 0)),
    averageGross: slips.length ? money(totalGross / slips.length) : 0,
    byDepartment: group((s) => s.employee.department.name).sort((a, b) => b.gross - a.gross),
    byDesignation: group((s) => s.employee.designation?.title ?? "Unassigned").sort((a, b) => b.averageGross - a.averageGross),
  };
}

/** Gender split and tenure buckets of the current headcount (Admin dashboard). */
export async function getWorkforceMix(asOf: string, departmentId?: string) {
  const staff = await db.employee.findMany({
    where: { status: { in: ["ACTIVE", "PROBATION"] }, joinDate: { lte: toDate(asOf) }, ...deptWhere(departmentId) },
    select: { gender: true, joinDate: true },
  });
  const gender = new Map<string, number>();
  const tenure = new Map<string, number>([["< 1 year", 0], ["1–3 years", 0], ["3–5 years", 0], ["5+ years", 0]]);
  const asOfMs = toDate(asOf).getTime();
  for (const s of staff) {
    const g = s.gender ?? "not set";
    gender.set(g, (gender.get(g) ?? 0) + 1);
    const years = (asOfMs - s.joinDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    const bucket = years < 1 ? "< 1 year" : years < 3 ? "1–3 years" : years < 5 ? "3–5 years" : "5+ years";
    tenure.set(bucket, tenure.get(bucket)! + 1);
  }
  return {
    gender: [...gender.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    tenure: [...tenure.entries()].map(([label, count]) => ({ label, count })),
  };
}

// ---------- the dashboard endpoint ----------

/** Validates the filter query; defaults to month-to-date. */
export function parseDashboardFilters(q: URLSearchParams): DashboardFilters {
  const today = todayIso();
  const start = q.get("start") || `${today.slice(0, 7)}-01`;
  const end = q.get("end") || today;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(start) || !iso.test(end)) throw badRequest("start and end must be YYYY-MM-DD");
  if (start > end) throw badRequest("start must be on or before end");
  if (toDate(end).getTime() - toDate(start).getTime() > 366 * 24 * 3600 * 1000) throw badRequest("The period can be at most one year.");
  return { start, end, department: q.get("department") || undefined };
}

/** Admin / HR: company dashboard. Employee: personal dashboard only, never company data. */
export async function getDashboard(actor: Session, f: DashboardFilters) {
  if (actor.role === "EMPLOYEE") return { kind: "personal" as const, ...(await getEmployeeDashboard(actor)) };

  const departmentId = await resolveDepartmentId(f.department);
  const [kpis, trend, leaveUtilization, departments, announcements] = await Promise.all([
    getDashboardKpis(actor, f),
    getAttendanceTrend({ ...f, departmentId }),
    getLeaveUtilization({ ...f, departmentId }),
    db.department.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    listAnnouncements(5),
  ]);
  const base = {
    kind: "company" as const,
    role: actor.role,
    filters: f,
    departments: departments.map((d) => d.name),
    kpis,
    trend,
    leaveUtilization,
    announcements,
  };
  if (actor.role !== "ADMIN") return base;

  const [payrollCost, workforce, auditFeed] = await Promise.all([getPayrollCost(f.end, departmentId), getWorkforceMix(f.end, departmentId), latestAudit(10)]);
  return { ...base, admin: { payrollCost, workforce, auditFeed } };
}

/** Employee dashboard: hours this week vs 40 h, late count this month, leave balance, last payslip, announcements. */
export async function getEmployeeDashboard(actor: Session, now: Date = new Date()) {
  if (!actor.employeeId) throw forbidden("Your login is not linked to an employee record.");
  const today = todayIso(now);
  const weekStart = addDays(today, -((weekdayOf(today) + 6) % 7)); // Monday
  const month = monthRange(today.slice(0, 7));

  const [week, attendance, balance, lastSlip, announcements] = await Promise.all([
    db.attendance.findMany({
      where: { employeeId: actor.employeeId, date: { gte: toDate(weekStart), lte: toDate(today) } },
      select: { date: true, checkIn: true, checkOut: true },
    }),
    getAttendanceSummary(actor, { start: month.start, end: today }),
    getLeaveBalance(actor),
    db.payslip.findFirst({
      where: { employeeId: actor.employeeId, run: { status: "FINALIZED" } },
      include: { run: true },
      orderBy: { run: { month: "desc" } },
    }),
    listAnnouncements(5),
  ]);

  // Closed days count check-in → check-out; today's open record counts up to now; past days with no check-out count 0.
  let ms = 0;
  for (const r of week) {
    const end = r.checkOut ?? (toIso(r.date) === today ? now : null);
    if (end && end > r.checkIn) ms += end.getTime() - r.checkIn.getTime();
  }
  const hoursThisWeek = Math.round((ms / 3_600_000) * 10) / 10;

  return {
    week: { start: weekStart, end: today, hours: hoursThisWeek, target: 40, pctOfTarget: pct(hoursThisWeek, 40) },
    month: { start: month.start, end: today, lateCount: attendance.counts.late, counts: attendance.counts, attendanceRatePct: attendance.attendanceRatePct },
    leaveBalance: balance.balances,
    lastPayslip: lastSlip
      ? { id: lastSlip.id, month: lastSlip.run.month, gross: Number(lastSlip.gross), net: Number(lastSlip.net), tax: Number(lastSlip.tax), deductions: Number(lastSlip.deductions) }
      : null,
    announcements,
  };
}
