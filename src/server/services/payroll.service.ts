import { audit, notify } from "@/lib/audit";
import { db } from "@/lib/db";
import { currentMonth, maxIso, minIso, monthRange, toDate, toIso, todayIso, workingDays } from "@/lib/dates";
import { badRequest, forbidden, HttpError } from "@/lib/errors";
import { assertRole, type Session } from "@/lib/session";
import { getDayRows } from "./attendance.service";
import { getHolidaySet, getSettings, resolveDepartmentId } from "./settings.service";

const money = (d: unknown) => Math.round(Number(d) * 100) / 100;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------- Pure payroll rules (Section 3, M6) ----------

/** Illustrative tax slab on annual taxable income. */
export function annualTax(annual: number): number {
  if (annual <= 600_000) return 0;
  if (annual <= 1_200_000) return (annual - 600_000) * 0.05;
  if (annual <= 2_400_000) return 30_000 + (annual - 1_200_000) * 0.15;
  if (annual <= 3_600_000) return 210_000 + (annual - 2_400_000) * 0.25;
  return 510_000 + (annual - 3_600_000) * 0.35;
}

/** Monthly tax on the month's earned gross, annualised (× 12) then ÷ 12, rounded to whole rupees. */
export function monthlyTax(earnedGrossMonthly: number): number {
  return Math.round(annualTax(Math.max(0, earnedGrossMonthly) * 12) / 12);
}

export interface PayInputs {
  basic: number;
  /** working days in the calendar month (weekdays minus holidays) */
  workingDays: number;
  absentDays: number;
  unpaidLeaveDays: number;
  halfDays: number;
  /** working days before joining / after leaving (proration) */
  daysNotEmployed: number;
}

/**
 * Gross = 1.5 × basic (HRA 40%, medical 10%). Per day = gross ÷ working days.
 * Deduct absent + unpaid leave + 0.5 × half days + days not employed. Net never below 0.
 */
export function computePay(i: PayInputs) {
  const basic = money(i.basic);
  const hra = money(i.basic * 0.4);
  const medical = money(i.basic * 0.1);
  const gross = money(i.basic * 1.5);
  const perDay = i.workingDays > 0 ? gross / i.workingDays : 0;
  const deductedDays = Math.min(i.workingDays, i.absentDays + i.unpaidLeaveDays + 0.5 * i.halfDays + i.daysNotEmployed);
  const deductions = money(perDay * deductedDays);
  const tax = monthlyTax(gross - deductions);
  const net = money(Math.max(0, gross - deductions - tax));
  return { basic, hra, medical, gross, perDay: money(perDay), deductedDays, deductions, tax, net, paidDays: i.workingDays - deductedDays };
}

// ---------- Payroll runs ----------

function assertMonth(month: string) {
  if (!MONTH_RE.test(month)) throw badRequest("Month must be YYYY-MM");
}

export async function listRuns(actor: Session) {
  assertRole(actor, "ADMIN", "HR");
  const runs = await db.payrollRun.findMany({ orderBy: { month: "desc" }, include: { payslips: { select: { gross: true, net: true } } } });
  return runs.map((r) => ({
    id: r.id,
    month: r.month,
    status: r.status,
    employees: r.payslips.length,
    totalGross: money(r.payslips.reduce((n, p) => n + Number(p.gross), 0)),
    totalNet: money(r.payslips.reduce((n, p) => n + Number(p.net), 0)),
    finalizedAt: r.finalizedAt,
    createdAt: r.createdAt,
  }));
}

/** Compute every payslip of a month from attendance, leave and salary. Nothing is written. */
export async function computeMonth(month: string) {
  assertMonth(month);
  const { start, end } = monthRange(month);
  const [settings, holidays] = await Promise.all([getSettings(), getHolidaySet(start, end)]);
  const monthDays = workingDays(start, end, settings.weekendDays, holidays);

  const employees = await db.employee.findMany({
    where: {
      status: { not: "INACTIVE" },
      joinDate: { lte: toDate(end) },
      OR: [{ exitDate: null }, { exitDate: { gte: toDate(start) } }],
    },
    orderBy: { code: "asc" },
  });
  if (!employees.length) return { month, workingDays: monthDays.length, slips: [] };

  const ids = employees.map((e) => e.id);
  const [rows, unpaidLeaves] = await Promise.all([
    getDayRows({ start, end }), // past working days only; today's not-yet-checked-in is not absent
    db.leaveRequest.findMany({
      where: {
        employeeId: { in: ids },
        status: "APPROVED",
        leaveType: { isPaid: false },
        startDate: { lte: toDate(end) },
        endDate: { gte: toDate(start) },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  // Group once (rows can be employees × working days; filtering per employee would be quadratic).
  const rowsByEmp = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = rowsByEmp.get(r.employeeId);
    if (list) list.push(r);
    else rowsByEmp.set(r.employeeId, [r]);
  }
  const unpaidByEmp = new Map<string, typeof unpaidLeaves>();
  for (const l of unpaidLeaves) unpaidByEmp.set(l.employeeId, [...(unpaidByEmp.get(l.employeeId) ?? []), l]);

  const slips = employees.map((e) => {
    const join = toIso(e.joinDate);
    const exit = e.exitDate ? toIso(e.exitDate) : null;
    const employed = (d: string) => d >= join && (!exit || d <= exit);
    const mine = rowsByEmp.get(e.id) ?? [];

    // Unpaid leave over the whole month (approved, so future days count too); only days while employed.
    const unpaid = new Set<string>();
    for (const l of unpaidByEmp.get(e.id) ?? []) {
      const from = maxIso(start, toIso(l.startDate));
      const to = minIso(end, toIso(l.endDate));
      for (const d of monthDays) if (d >= from && d <= to && employed(d)) unpaid.add(d);
    }

    const pay = computePay({
      basic: Number(e.basicSalary),
      workingDays: monthDays.length,
      absentDays: mine.filter((r) => r.status === "absent").length,
      unpaidLeaveDays: unpaid.size,
      halfDays: mine.filter((r) => r.status === "half_day").length,
      daysNotEmployed: monthDays.filter((d) => !employed(d)).length,
    });
    return { employeeId: e.id, workingDays: monthDays.length, ...pay };
  });
  return { month, workingDays: monthDays.length, slips };
}

/** HR creates the month's draft, or recomputes it (payslips are replaced). Finalized months are locked. */
export async function createOrRecomputeDraft(actor: Session, month: string) {
  assertRole(actor, "HR");
  assertMonth(month);
  if (month > todayIso().slice(0, 7)) throw badRequest("Payroll cannot be run for a future month.");
  const existing = await db.payrollRun.findUnique({ where: { month } });
  if (existing?.status === "FINALIZED") throw new HttpError(409, `Payroll for ${month} is finalized and locked.`, "locked");

  const computed = await computeMonth(month);
  return db.$transaction(async (tx) => {
    const run = existing ?? (await tx.payrollRun.create({ data: { month, createdById: actor.userId } }));
    if (existing) {
      // Re-check the lock inside the transaction: an Admin may have finalized the month since we read it.
      // The conditional UPDATE also row-locks the run, so a concurrent finalize waits for us (or we see FINALIZED).
      const { count } = await tx.payrollRun.updateMany({ where: { id: run.id, status: "DRAFT" }, data: { createdById: actor.userId } });
      if (!count) throw new HttpError(409, `Payroll for ${month} is finalized and locked.`, "locked");
      await tx.payslip.deleteMany({ where: { runId: run.id } });
    }
    await tx.payslip.createMany({
      data: computed.slips.map((s) => ({
        runId: run.id,
        employeeId: s.employeeId,
        basic: s.basic,
        hra: s.hra,
        medical: s.medical,
        gross: s.gross,
        deductions: s.deductions,
        tax: s.tax,
        net: s.net,
        workingDays: s.workingDays,
        paidDays: s.paidDays,
      })),
    });
    const totals = { employees: computed.slips.length, totalGross: money(computed.slips.reduce((n, s) => n + s.gross, 0)), totalNet: money(computed.slips.reduce((n, s) => n + s.net, 0)) };
    await audit(actor, existing ? "recompute" : "create", "payroll_run", run.id, { after: { month, status: "DRAFT", ...totals } }, tx);
    return { id: run.id, month, status: "DRAFT" as const, ...totals };
  });
}

export async function getRun(actor: Session, month: string) {
  assertRole(actor, "ADMIN", "HR");
  assertMonth(month);
  const run = await db.payrollRun.findUnique({
    where: { month },
    include: { payslips: { include: { employee: { include: { department: true } } }, orderBy: { employee: { code: "asc" } } } },
  });
  if (!run) throw new HttpError(404, `No payroll run for ${month} yet.`, "not_found");
  const payslips = run.payslips.map((p) => ({
    id: p.id,
    employeeId: p.employeeId,
    code: p.employee.code,
    name: p.employee.fullName,
    department: p.employee.department.name,
    basic: money(p.basic),
    hra: money(p.hra),
    medical: money(p.medical),
    gross: money(p.gross),
    deductions: money(p.deductions),
    tax: money(p.tax),
    net: money(p.net),
    workingDays: p.workingDays,
    paidDays: p.paidDays,
  }));
  const sum = (k: "gross" | "deductions" | "tax" | "net") => money(payslips.reduce((n, p) => n + p[k], 0));
  return {
    id: run.id,
    month: run.month,
    status: run.status,
    finalizedAt: run.finalizedAt,
    totals: { employees: payslips.length, gross: sum("gross"), deductions: sum("deductions"), tax: sum("tax"), net: sum("net") },
    payslips,
  };
}

/** Admin only. Locks the month and tells every employee their payslip is ready. */
export async function finalizeRun(actor: Session, month: string) {
  assertRole(actor, "ADMIN");
  assertMonth(month);
  const run = await db.payrollRun.findUnique({ where: { month }, include: { payslips: { include: { employee: { select: { userId: true } } } } } });
  if (!run) throw new HttpError(404, `No payroll run for ${month} yet.`, "not_found");
  if (run.status === "FINALIZED") throw new HttpError(409, `Payroll for ${month} is already finalized.`, "locked");
  if (!run.payslips.length) throw badRequest("This run has no payslips.");

  return db.$transaction(async (tx) => {
    // Conditional update so two concurrent finalize calls cannot both succeed.
    const { count } = await tx.payrollRun.updateMany({
      where: { id: run.id, status: "DRAFT" },
      data: { status: "FINALIZED", finalizedById: actor.userId, finalizedAt: new Date() },
    });
    if (!count) throw new HttpError(409, `Payroll for ${month} is already finalized.`, "locked");
    await notify(run.payslips.map((p) => p.employee.userId), { title: `Payslip for ${month} is ready`, body: "You can view and download it now.", link: "/payslips" }, tx);
    await audit(actor, "finalize", "payroll_run", run.id, { before: { status: "DRAFT" }, after: { month, status: "FINALIZED", payslips: run.payslips.length } }, tx);
    return { id: run.id, month, status: "FINALIZED" as const };
  });
}

// ---------- Payslips ----------

/** Employee: own payslips from finalized runs only. Admin / HR: all (drafts included). */
export async function listPayslips(actor: Session, opts: { month?: string } = {}) {
  if (opts.month) assertMonth(opts.month);
  const own = actor.role === "EMPLOYEE";
  if (own && !actor.employeeId) throw forbidden();
  const rows = await db.payslip.findMany({
    where: {
      ...(own && { employeeId: actor.employeeId! }),
      run: { ...(own && { status: "FINALIZED" as const }), ...(opts.month && { month: opts.month }) },
    },
    include: { run: true, employee: { include: { department: true } } },
    orderBy: [{ run: { month: "desc" } }, { employee: { code: "asc" } }],
  });
  return rows.map((p) => ({
    id: p.id,
    month: p.run.month,
    status: p.run.status,
    code: p.employee.code,
    name: p.employee.fullName,
    department: p.employee.department.name,
    gross: money(p.gross),
    deductions: money(p.deductions),
    tax: money(p.tax),
    net: money(p.net),
  }));
}

/** Everything a payslip PDF shows, with the same scope rules as the list. */
export async function getPayslipDetail(actor: Session, id: string) {
  const p = await db.payslip.findUnique({
    where: { id },
    include: { run: true, employee: { include: { department: true, designation: true } } },
  });
  if (!p) throw new HttpError(404, "Payslip not found", "not_found");
  if (actor.role === "EMPLOYEE" && (p.employeeId !== actor.employeeId || p.run.status !== "FINALIZED")) throw forbidden();
  const settings = await getSettings();
  return {
    id: p.id,
    companyName: settings.companyName,
    month: p.run.month,
    status: p.run.status,
    employee: { code: p.employee.code, name: p.employee.fullName, department: p.employee.department.name, designation: p.employee.designation?.title ?? null },
    workingDays: p.workingDays,
    paidDays: p.paidDays,
    basic: money(p.basic),
    hra: money(p.hra),
    medical: money(p.medical),
    gross: money(p.gross),
    deductions: money(p.deductions),
    tax: money(p.tax),
    net: money(p.net),
  };
}

export type PayslipDetail = Awaited<ReturnType<typeof getPayslipDetail>>;

/**
 * Admin / HR: totals of a payroll run (drafts included, marked as such).
 * Employee: only their own payslip from a finalized run. Never anyone else's.
 */
export async function getPayrollSummary(actor: Session, opts: { month?: string; department?: string } = {}) {
  if (actor.role === "EMPLOYEE") return getOwnPayslip(actor, opts.month);

  const departmentId = await resolveDepartmentId(opts.department);
  const run = opts.month
    ? await db.payrollRun.findUnique({ where: { month: opts.month } })
    : await db.payrollRun.findFirst({ orderBy: { month: "desc" } });
  if (!run) {
    return { month: opts.month ?? currentMonth(), found: false, message: "No payroll run exists for this month yet." };
  }

  const slips = await db.payslip.findMany({
    where: { runId: run.id, ...(departmentId && { employee: { departmentId } }) },
    include: { employee: { include: { department: true } } },
  });

  const byDept = new Map<string, { employees: number; gross: number; net: number }>();
  let gross = 0, net = 0, tax = 0, deductions = 0;
  for (const s of slips) {
    gross += Number(s.gross);
    net += Number(s.net);
    tax += Number(s.tax);
    deductions += Number(s.deductions);
    const d = byDept.get(s.employee.department.name) ?? { employees: 0, gross: 0, net: 0 };
    d.employees++;
    d.gross += Number(s.gross);
    d.net += Number(s.net);
    byDept.set(s.employee.department.name, d);
  }

  return {
    month: run.month,
    found: true,
    status: run.status, // DRAFT numbers can still change; FINALIZED is locked
    department: opts.department ?? "all",
    employees: slips.length,
    totalGross: money(gross),
    totalNet: money(net),
    totalTax: money(tax),
    totalDeductions: money(deductions),
    averageGross: slips.length ? money(gross / slips.length) : 0,
    byDepartment: [...byDept.entries()].map(([department, d]) => ({
      department,
      employees: d.employees,
      gross: money(d.gross),
      net: money(d.net),
    })),
  };
}

async function getOwnPayslip(actor: Session, month?: string) {
  if (!actor.employeeId) throw forbidden();
  const slip = await db.payslip.findFirst({
    where: { employeeId: actor.employeeId, run: { status: "FINALIZED", ...(month && { month }) } },
    include: { run: true },
    orderBy: { run: { month: "desc" } },
  });
  if (!slip) return { scope: "own", found: false, message: month ? `No finalized payslip for ${month}.` : "No finalized payslip yet." };
  return {
    scope: "own",
    found: true,
    month: slip.run.month,
    basic: money(slip.basic),
    hra: money(slip.hra),
    medical: money(slip.medical),
    gross: money(slip.gross),
    deductions: money(slip.deductions),
    tax: money(slip.tax),
    net: money(slip.net),
    workingDays: slip.workingDays,
    paidDays: slip.paidDays,
  };
}
