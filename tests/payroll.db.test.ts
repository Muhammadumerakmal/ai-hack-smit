import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as finalizeRoute from "@/app/api/payroll/runs/[month]/finalize/route";
import * as runRoute from "@/app/api/payroll/runs/[month]/route";
import * as runsRoute from "@/app/api/payroll/runs/route";
import * as pdfRoute from "@/app/api/payslips/[id]/pdf/route";
import * as payslipsRoute from "@/app/api/payslips/route";
import { addDays, currentMonth, monthRange, toDate, todayIso, workingDays } from "@/lib/dates";
import { annualTax, computePay, monthlyTax } from "@/server/services/payroll.service";
import { call, hasDb, seed, sessionFor } from "./helpers";

// Routes with typed params ({ month } / { id }) vs the helper's generic Record<string, string> signature.
const h = (fn: unknown) => fn as Parameters<typeof call>[0];

describe("payroll rules (pure)", () => {
  it("applies the tax slab at each boundary", () => {
    expect(annualTax(0)).toBe(0);
    expect(annualTax(600_000)).toBe(0);
    expect(annualTax(900_000)).toBe(15_000); // 5% of 300k
    expect(annualTax(1_200_000)).toBe(30_000);
    expect(annualTax(2_400_000)).toBe(210_000); // 30k + 15% of 1.2M
    expect(annualTax(3_600_000)).toBe(510_000); // 210k + 25% of 1.2M
    expect(annualTax(4_000_000)).toBe(650_000); // 510k + 35% of 400k
  });

  it("computes monthly tax on annualised earned gross", () => {
    expect(monthlyTax(150_000)).toBe(10_000); // 1.8M → 30k + 15% × 600k = 120k / 12
    expect(monthlyTax(50_000)).toBe(0); // 600k
  });

  it("pays a full month: gross = 1.5 × basic, HRA 40%, medical 10%", () => {
    const p = computePay({ basic: 100_000, workingDays: 22, absentDays: 0, unpaidLeaveDays: 0, halfDays: 0, daysNotEmployed: 0 });
    expect(p).toMatchObject({ basic: 100_000, hra: 40_000, medical: 10_000, gross: 150_000, deductions: 0, tax: 10_000, net: 140_000, paidDays: 22 });
  });

  it("deducts absent days and half a day per half day", () => {
    const p = computePay({ basic: 100_000, workingDays: 20, absentDays: 2, unpaidLeaveDays: 0, halfDays: 2, daysNotEmployed: 0 });
    // per day 7,500 × 3 days = 22,500; earned 127,500 × 12 = 1.53M → tax 30k + 15% × 330k = 79,500 / 12 = 6,625
    expect(p).toMatchObject({ perDay: 7_500, deductedDays: 3, deductions: 22_500, tax: 6_625, net: 120_875, paidDays: 17 });
  });

  it("deducts unpaid leave", () => {
    const p = computePay({ basic: 60_000, workingDays: 20, absentDays: 0, unpaidLeaveDays: 1, halfDays: 0, daysNotEmployed: 0 });
    expect(p.deductions).toBe(4_500); // 90,000 / 20
  });

  it("prorates a mid-month joiner", () => {
    const p = computePay({ basic: 100_000, workingDays: 22, absentDays: 0, unpaidLeaveDays: 0, halfDays: 0, daysNotEmployed: 11 });
    expect(p).toMatchObject({ deductions: 75_000, paidDays: 11 });
  });

  it("never pays below zero and never deducts more than the month", () => {
    const p = computePay({ basic: 100_000, workingDays: 10, absentDays: 8, unpaidLeaveDays: 5, halfDays: 4, daysNotEmployed: 3 });
    expect(p).toMatchObject({ deductedDays: 10, deductions: 150_000, net: 0, paidDays: 0 });
  });
});

describe.skipIf(!hasDb)("payroll runs and payslips (DB + routes)", () => {
  const db = new PrismaClient();
  const month = currentMonth();
  let ids: Record<string, string>;
  let seededDays: string[];
  let admin: string, hr: string, sara: string, ali: string, saraEmp: string;

  beforeAll(async () => {
    const r = await seed(db);
    ids = r.employees;
    seededDays = r.workingDaysSoFar;
    admin = (await sessionFor(db, "admin@demo.test")).userId;
    hr = (await sessionFor(db, "hr@demo.test")).userId;
    const s = await sessionFor(db, "sara@demo.test");
    sara = s.userId;
    saraEmp = s.employeeId!;
    ali = (await sessionFor(db, "ali@demo.test")).userId;
  });
  afterAll(() => db.$disconnect());

  it("refuses employees and admins creating a draft (HR only)", async () => {
    expect((await call(runsRoute.POST, { userId: sara, body: { month } })).status).toBe(403);
    expect((await call(runsRoute.POST, { userId: admin, body: { month } })).status).toBe(403);
  });

  it("rejects bad and future months", async () => {
    expect((await call(runsRoute.POST, { userId: hr, body: { month: "2026-13" } })).status).toBe(400);
    const future = monthRange(month).end;
    const next = addDays(future, 1).slice(0, 7);
    expect((await call(runsRoute.POST, { userId: hr, body: { month: next } })).status).toBe(400);
  });

  it("HR creates the draft from real attendance (Sara: 1 absence, 1 half day)", async () => {
    const res = await call(runsRoute.POST, { userId: hr, body: { month } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month, status: "DRAFT", employees: 5 });

    const { start, end } = monthRange(month);
    const wd = workingDays(start, end, [0, 6], new Set([`${month.slice(0, 4)}-12-25`])).length;
    const run = await call(h(runRoute.GET), { userId: hr, params: { month } });
    const saraSlip = run.body.payslips.find((p: { code: string }) => p.code === "E003");
    const absent = seededDays.length > 6 ? 1 : 0;
    const half = seededDays.length > 2 ? 1 : 0;
    const gross = 140_000 * 1.5;
    expect(saraSlip.gross).toBe(gross);
    expect(saraSlip.workingDays).toBe(wd);
    expect(saraSlip.deductions).toBeCloseTo((gross / wd) * (absent + 0.5 * half), 1);
    expect(saraSlip.paidDays).toBe(wd - absent - 0.5 * half);
    // Bilal's sick leave is paid: no deduction for those days.
    const bilal = run.body.payslips.find((p: { code: string }) => p.code === "E004");
    expect(bilal.deductions).toBe(0);
  });

  it("deducts approved unpaid leave on recompute", async () => {
    const { start, end } = monthRange(month);
    const day = workingDays(start, end, [0, 6], new Set()).at(-1)!;
    const unpaid = await db.leaveType.findUniqueOrThrow({ where: { companyId_code: { companyId: 1, code: "unpaid" } } });
    await db.leaveRequest.create({
      data: { companyId: 1, employeeId: ids.E002, leaveTypeId: unpaid.id, startDate: toDate(day), endDate: toDate(day), days: 1, reason: "Personal", status: "APPROVED" },
    });
    expect((await call(runsRoute.POST, { userId: hr, body: { month } })).status).toBe(200);
    const run = await call(h(runRoute.GET), { userId: admin, params: { month } });
    const aliSlip = run.body.payslips.find((p: { code: string }) => p.code === "E002");
    expect(aliSlip.deductions).toBeCloseTo((150_000 * 1.5) / aliSlip.workingDays, 1);
    expect(run.body.payslips).toHaveLength(5); // recompute replaced, not duplicated
  });

  it("prorates a joiner who starts mid-month", async () => {
    const { start, end } = monthRange(month);
    const days = workingDays(start, end, [0, 6], new Set([`${month.slice(0, 4)}-12-25`]));
    const joinDay = days[Math.floor(days.length / 2)];
    const dept = await db.department.findFirstOrThrow();
    const emp = await db.employee.create({
      data: { companyId: 1, code: "E099", fullName: "New Joiner", email: "new@demo.test", departmentId: dept.id, joinDate: toDate(joinDay), status: "PROBATION", basicSalary: 100_000 },
    });
    await call(runsRoute.POST, { userId: hr, body: { month } });
    const run = await call(h(runRoute.GET), { userId: hr, params: { month } });
    const slip = run.body.payslips.find((p: { code: string }) => p.code === "E099");
    const notEmployed = days.filter((d) => d < joinDay).length;
    // Past working days since joining with no attendance are absent too.
    const today = todayIso();
    const absent = days.filter((d) => d >= joinDay && d < today).length;
    expect(slip.paidDays).toBe(days.length - notEmployed - absent);
    await db.payslip.deleteMany({ where: { employeeId: emp.id } });
    await db.employee.delete({ where: { id: emp.id } });
    await call(runsRoute.POST, { userId: hr, body: { month } });
  });

  it("employees see only their own FINALIZED payslips", async () => {
    const res = await call(payslipsRoute.GET, { userId: sara });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((p: { code: string; status: string }) => p.code === "E003" && p.status === "FINALIZED")).toBe(true);
    expect(res.body.items.some((p: { month: string }) => p.month === month)).toBe(false); // this month is still a draft
  });

  it("blocks employees from another person's payslip PDF and from drafts", async () => {
    const aliSlip = await db.payslip.findFirstOrThrow({ where: { employeeId: ids.E002 }, include: { run: true }, orderBy: { run: { month: "asc" } } });
    expect((await call(h(pdfRoute.GET), { userId: sara, params: { id: aliSlip.id } })).status).toBe(403);
    const saraDraft = await db.payslip.findFirstOrThrow({ where: { employeeId: saraEmp, run: { month } } });
    expect((await call(h(pdfRoute.GET), { userId: sara, params: { id: saraDraft.id } })).status).toBe(403);
  });

  it("HR cannot finalize; Admin finalizes, employees are notified, and the month locks", async () => {
    expect((await call(h(finalizeRoute.POST), { userId: hr, params: { month } })).status).toBe(403);
    expect((await call(h(finalizeRoute.POST), { userId: sara, params: { month } })).status).toBe(403);

    const before = await db.notification.count({ where: { userId: sara } });
    const res = await call(h(finalizeRoute.POST), { userId: admin, params: { month } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("FINALIZED");
    expect(await db.notification.count({ where: { userId: sara } })).toBe(before + 1);
    expect(await db.auditLog.count({ where: { entity: "payroll_run", action: "finalize" } })).toBe(1);

    expect((await call(runsRoute.POST, { userId: hr, body: { month } })).status).toBe(409);
    expect((await call(h(finalizeRoute.POST), { userId: admin, params: { month } })).status).toBe(409);
  });

  it("serves the employee's own finalized payslip as a PDF", async () => {
    const own = await db.payslip.findFirstOrThrow({ where: { employeeId: saraEmp, run: { month } } });
    const res = await call(h(pdfRoute.GET), { userId: sara, params: { id: own.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`payslip-E003-${month}.pdf`);
    const bytes = res.body as Uint8Array;
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Sara Ahmed");
    expect(text).toContain("Net pay");

    // HR may download anyone's.
    const ali = await db.payslip.findFirstOrThrow({ where: { employeeId: ids.E002, run: { month } } });
    expect((await call(h(pdfRoute.GET), { userId: hr, params: { id: ali.id } })).status).toBe(200);
  });

  it("lists runs for Admin/HR only", async () => {
    const res = await call(runsRoute.GET, { userId: admin });
    expect(res.body.items.map((r: { month: string }) => r.month)).toContain(month);
    expect((await call(runsRoute.GET, { userId: ali })).status).toBe(403);
    expect((await call(h(runRoute.GET), { userId: ali, params: { month } })).status).toBe(403);
  });

  it("returns 404 for a month with no run", async () => {
    expect((await call(h(runRoute.GET), { userId: hr, params: { month: "2001-01" } })).status).toBe(404);
  });
});
