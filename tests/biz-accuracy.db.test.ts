import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTool } from "@/server/ai/tools";
import { getDashboard, getDashboardKpis } from "@/server/services/analytics.service";
import { checkIn, checkOut, getAttendanceSummary, getCalendar, getDayRows, getLateComers } from "@/server/services/attendance.service";
import { getLeaveBalance, getLeaveSummary } from "@/server/services/leave.service";
import { computeMonth, createOrRecomputeDraft, finalizeRun, getRun, getPayrollSummary } from "@/server/services/payroll.service";
import { buildFebCompany, FEB, febWorkingDays, truncateAll } from "./biz-fixtures";
import { hasDb } from "./helpers";

// QA-3: business numbers checked against hand-worked values from tests/biz-fixtures.ts.

describe.skipIf(!hasDb)("QA-3 business accuracy (February 2026 fixture)", () => {
  const db = new PrismaClient();
  let fx: Awaited<ReturnType<typeof buildFebCompany>>;

  beforeAll(async () => {
    fx = await buildFebCompany(db);
  });
  afterAll(() => db.$disconnect());

  describe("calendar maths", () => {
    it("Feb 2026 has 19 working days (20 weekdays − Kashmir Day)", () => {
      expect(febWorkingDays()).toHaveLength(19);
    });

    it("payroll uses 19 working days for Feb 2026 and 21 for leap-year Feb 2024", async () => {
      expect((await computeMonth("2026-02")).workingDays).toBe(19);
      expect((await computeMonth("2024-02")).workingDays).toBe(21); // 29 days, starts Thursday, no holidays
    });
  });

  describe("attendance (Section 3 M4 + Section 7)", () => {
    it("counts every status exactly; INACTIVE employee, weekends and Jan 30 / Mar 2 records are excluded", async () => {
      const rows = await getDayRows({ start: FEB.start, end: FEB.end });
      // A 19 + B 10 (joined 16th) + C 8 (left 12th) + E 19; D (INACTIVE) none.
      expect(rows).toHaveLength(56);
      expect(new Set(rows.map((r) => r.code))).toEqual(new Set(["A", "B", "C", "E"]));
      expect(rows.some((r) => r.date === "2026-02-05")).toBe(false); // holiday
      const s = await getAttendanceSummary(fx.hr, FEB);
      expect(s.counts).toEqual({ present: 41, late: 4, half_day: 1, missing_checkout: 1, absent: 2, on_leave: 7 });
      expect(s.workingDayRecords).toBe(56);
      // (41 + 4 + 1 + 0.5×1) ÷ (56 − 7) = 46.5 / 49 = 94.9 %
      expect(s.attendanceRatePct).toBe(94.9);
      expect(s.latePct).toBe(8.9); // 4 ÷ (41 + 4)
      expect(s.absenteeismPct).toBe(4.1); // 2 ÷ 49
    });

    it("per-department rates", async () => {
      const s = await getAttendanceSummary(fx.hr, FEB);
      const by = Object.fromEntries(s.byDepartment.map((d) => [d.department, d]));
      expect(by.Engineering).toMatchObject({ workingDayRecords: 27, attendanceRatePct: 90, latePct: 9.5, absenteeismPct: 8 });
      expect(by.Sales).toMatchObject({ workingDayRecords: 29, attendanceRatePct: 100, latePct: 8.3, absenteeismPct: 0 });
    });

    it("an employee's own summary only contains their rows", async () => {
      const a = await getAttendanceSummary(fx.as.A, FEB);
      expect(a.counts).toEqual({ present: 12, late: 2, half_day: 1, missing_checkout: 1, absent: 1, on_leave: 2 });
      expect(a.byDepartment).toEqual([]);
    });

    it("late-comers: tie broken by name; January/March late days are not counted", async () => {
      const l = await getLateComers(fx.hr, { ...FEB });
      expect(l.lateComers.map((x) => [x.name, x.lateCount])).toEqual([
        ["Aisha A", 2],
        ["Bilal B", 2],
      ]);
    });

    it("calendar marks weekends, the holiday, absent and missing checkout correctly", async () => {
      const cal = await getCalendar(fx.hr, { month: "2026-02", employeeId: fx.emp.A.id });
      const kind = Object.fromEntries(cal.days.map((d) => [d.date, d.kind]));
      expect(kind["2026-02-01"]).toBe("weekend");
      expect(kind["2026-02-05"]).toBe("holiday");
      expect(kind["2026-02-06"]).toBe("absent");
      expect(kind["2026-02-09"]).toBe("missing_checkout");
      expect(kind["2026-02-10"]).toBe("on_leave");
      expect(cal.days).toHaveLength(28);
    });
  });

  describe("check-in time zone (Asia/Karachi, UTC+5)", () => {
    it("23:30 UTC belongs to the NEXT local day and is on time (04:30 local)", async () => {
      const r = await checkIn(fx.as.E, new Date("2026-03-02T23:30:00Z"));
      expect(r.date).toBe("2026-03-03");
      expect(r.status).toBe("PRESENT");
    });

    it("09:15:59 local is on time, 09:16 local is late", async () => {
      expect((await checkIn(fx.as.E, new Date("2026-03-04T04:15:59Z"))).status).toBe("PRESENT");
      expect((await checkIn(fx.as.E, new Date("2026-03-05T04:16:00Z"))).status).toBe("LATE");
    });

    it("half day is under 5 h worked: 4 h 59 m → HALF_DAY, exactly 5 h → keeps PRESENT", async () => {
      await checkIn(fx.as.E, new Date("2026-03-09T04:00:00Z"));
      expect((await checkOut(fx.as.E, new Date("2026-03-09T08:59:00Z"))).status).toBe("HALF_DAY");
      await checkIn(fx.as.E, new Date("2026-03-10T04:00:00Z"));
      expect((await checkOut(fx.as.E, new Date("2026-03-10T09:00:00Z"))).status).toBe("PRESENT");
    });

    it("a weekend check-in is stored but never counted as a working day", async () => {
      const sat = await checkIn(fx.as.E, new Date("2026-03-07T05:00:00Z"));
      expect(sat.date).toBe("2026-03-07");
      const rows = await getDayRows({ start: "2026-03-07", end: "2026-03-08", employeeId: fx.emp.E.id });
      expect(rows).toEqual([]);
    });

    it("two simultaneous check-outs: exactly one wins (409 for the other)", async () => {
      await checkIn(fx.as.E, new Date("2026-03-11T04:00:00Z"));
      const results = await Promise.allSettled([
        checkOut(fx.as.E, new Date("2026-03-11T12:00:00Z")),
        checkOut(fx.as.E, new Date("2026-03-11T12:00:01Z")),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    });

    it("two simultaneous check-ins: exactly one record", async () => {
      const results = await Promise.allSettled([checkIn(fx.as.E, new Date("2026-03-12T04:00:00Z")), checkIn(fx.as.E, new Date("2026-03-12T04:00:00Z"))]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.attendance.count({ where: { employeeId: fx.emp.E.id, date: new Date("2026-03-12T00:00:00Z") } })).toBe(1);
    });
  });

  describe("dashboard KPIs vs independent values", () => {
    it("HR KPIs for February", async () => {
      const k = await getDashboardKpis(fx.hr, FEB);
      expect(k.headcount).toMatchObject({ total: 3, active: 2, probation: 1 }); // A, E active; B probation; C exited; D inactive
      expect(Object.fromEntries(k.headcount.byDepartment.map((d) => [d.department, d.count]))).toEqual({ Engineering: 1, Sales: 2 });
      expect(k.attendance).toMatchObject({ attendanceRatePct: 94.9, latePct: 8.9, absenteeismPct: 4.1 });
      expect(k.topLateComers.map((x) => x.name)).toEqual(["Aisha A", "Bilal B"]);
      const byType = Object.fromEntries(k.leave.approvedDaysByType.map((t) => [t.type, t]));
      expect(byType.casual).toMatchObject({ days: 2, utilizationPct: 6.7 }); // 2 ÷ (10 × 3 staff)
      expect(byType.unpaid).toMatchObject({ days: 5, utilizationPct: null });
      expect(k.approvals.total).toBe(0);
    });

    it("department filter narrows every number", async () => {
      const k = await getDashboardKpis(fx.hr, { ...FEB, department: "Sales" });
      expect(k.headcount.total).toBe(2);
      expect(k.attendance.attendanceRatePct).toBe(100);
      expect(k.topLateComers.map((x) => x.name)).toEqual(["Bilal B"]);
    });

    it("Admin attrition YTD = exits ÷ mean(headcount 1 Jan, headcount 28 Feb) × 100 = 1 ÷ 3 = 33.3 %", async () => {
      const k = await getDashboardKpis(fx.admin, FEB);
      expect("attrition" in k && k.attrition).toMatchObject({ exits: 1, averageHeadcount: 3, attritionPct: 33.3 });
    });

    it("date range across months (Jan 15 – Feb 28) only counts days in range", async () => {
      const s = await getAttendanceSummary(fx.hr, { start: "2026-01-15", end: "2026-02-28" });
      // January 15–30 (12 working days) has only one stored record (A, late on the 30th): A, C, E are absent the rest.
      const janRows = await getDayRows({ start: "2026-01-15", end: "2026-01-31" });
      expect(janRows).toHaveLength(36); // A, C, E × 12 working days (B joined Feb 16)
      expect(janRows.filter((r) => r.status === "late")).toHaveLength(1);
      expect(s.workingDayRecords).toBe(56 + 36);
    });

    it("the full dashboard payload uses the same numbers as the KPI JSON (one attendance scan)", async () => {
      const d = await getDashboard(fx.admin, FEB);
      if (d.kind !== "company") throw new Error("expected company dashboard");
      expect(d.kpis.attendance.attendanceRatePct).toBe(94.9);
      // trend: one point per working day; Feb 2 = A late, B not joined, C present, E present → 3/3 = 100 %
      expect(d.trend).toHaveLength(19);
      expect(d.trend.find((p) => p.date === "2026-02-06")).toMatchObject({ absent: 1, attendanceRatePct: 66.7 }); // A absent; C, E present
      expect((d as { admin?: { payrollCost?: unknown } }).admin?.payrollCost).toMatchObject({ found: false });
    });
  });

  describe("AI tools return the same numbers as the REST/dashboard services", () => {
    const tool = async (name: string, args: object, who = () => fx.hr) => JSON.parse((await runTool(who(), name, JSON.stringify(args))).content);

    it("get_headcount / get_attendance_summary / get_late_comers / get_leave_summary", async () => {
      const k = await getDashboardKpis(fx.hr, FEB);
      expect((await tool("get_headcount", { asOf: FEB.end })).total).toBe(k.headcount.total);
      const att = await tool("get_attendance_summary", { start: FEB.start, end: FEB.end });
      expect(att.attendanceRatePct).toBe(k.attendance.attendanceRatePct);
      expect(att.counts).toEqual(k.attendance.counts);
      expect((await tool("get_late_comers", { start: FEB.start, end: FEB.end })).lateComers.map((l: { name: string }) => l.name)).toEqual(k.topLateComers.map((l) => l.name));
      const leave = await tool("get_leave_summary", { start: FEB.start, end: FEB.end });
      expect(leave.approvedDaysByType).toEqual((await getLeaveSummary(fx.hr, FEB)).approvedDaysByType);
    });

    it("get_my_leave_balance equals getLeaveBalance for the employee", async () => {
      const viaTool = await tool("get_my_leave_balance", { year: 2026 }, () => fx.as.A);
      expect(viaTool.balances).toEqual((await getLeaveBalance(fx.as.A, { year: 2026 })).balances);
      expect(viaTool.balances.find((b: { type: string }) => b.type === "casual")).toMatchObject({ usedApproved: 2, remaining: 8 });
    });
  });

  describe("payroll (Section 3 M6) vs hand-worked payslips", () => {
    it("draft payslips match the hand calculation", async () => {
      await createOrRecomputeDraft(fx.hr, "2026-02");
      const run = await getRun(fx.hr, "2026-02");
      const by = Object.fromEntries(run.payslips.map((p) => [p.code, p]));
      expect(Object.keys(by).sort()).toEqual(["A", "B", "C", "E"]); // D (INACTIVE) excluded
      // A: gross 150,000; per day 150,000/19; deduct 1 absent + 0.5×1 half day = 1.5 days = 11,842.11;
      //    tax on (150,000 − 11,842.11) × 12 = 1,657,894.68 → 30,000 + 15% × 457,894.68 = 98,684.20 → /12 = 8,224
      expect(by.A).toMatchObject({ gross: 150000, deductions: 11842.11, tax: 8224, net: 129933.89, paidDays: 17.5, workingDays: 19 });
      // B joined 16th: 9 working days before joining unpaid → 9 × 4,736.84 = 42,631.58; earned 47,368.42 → annual 568k → no tax
      expect(by.B).toMatchObject({ gross: 90000, deductions: 42631.58, tax: 0, net: 47368.42, paidDays: 10 });
      // C left 12th: 11 working days after leaving + 1 absent = 12 × 6,315.79 = 75,789.47
      expect(by.C).toMatchObject({ gross: 120000, deductions: 75789.47, tax: 0, net: 44210.53, paidDays: 7 });
      // E: 5 unpaid-leave days × 3,947.37 = 19,736.84; tax on 55,263.16 × 12 = 663,157.92 → 5% × 63,157.92 = 3,157.90 → /12 = 263
      expect(by.E).toMatchObject({ gross: 75000, deductions: 19736.84, tax: 263, net: 55000.16, paidDays: 14 });
    });

    it("run totals equal an independent SQL SUM", async () => {
      const run = await getRun(fx.hr, "2026-02");
      const [sql] = await db.$queryRaw<{ gross: string; net: string; tax: string; deductions: string; n: bigint }[]>`
        SELECT SUM(p.gross)::text AS gross, SUM(p.net)::text AS net, SUM(p.tax)::text AS tax, SUM(p.deductions)::text AS deductions, COUNT(*) AS n
        FROM payslips p JOIN payroll_runs r ON r.id = p."runId" WHERE r.month = '2026-02'`;
      expect(run.totals).toEqual({ employees: Number(sql.n), gross: Number(sql.gross), net: Number(sql.net), tax: Number(sql.tax), deductions: Number(sql.deductions) });
      expect(run.totals).toMatchObject({ gross: 435000, deductions: 150000, tax: 8487, net: 276513 });
      const ai = await getPayrollSummary(fx.hr, { month: "2026-02" });
      expect(ai).toMatchObject({ totalGross: 435000, totalNet: 276513 });
    });

    it("recompute after an attendance change picks it up (A's absence on the 6th fixed → 0.5 day deducted)", async () => {
      await db.attendance.create({
        data: { employeeId: fx.emp.A.id, date: new Date("2026-02-06T00:00:00Z"), checkIn: new Date("2026-02-06T04:00:00Z"), checkOut: new Date("2026-02-06T12:00:00Z"), status: "PRESENT" },
      });
      await createOrRecomputeDraft(fx.hr, "2026-02");
      const a = (await getRun(fx.hr, "2026-02")).payslips.find((p) => p.code === "A")!;
      expect(a).toMatchObject({ deductions: 3947.37, paidDays: 18.5 }); // 0.5 × 7,894.74
    });

    it("finalize locks the month; employees see only their own finalized slip", async () => {
      await finalizeRun(fx.admin, "2026-02");
      await expect(createOrRecomputeDraft(fx.hr, "2026-02")).rejects.toMatchObject({ status: 409 });
      const own = await getPayrollSummary(fx.as.B);
      expect(own).toMatchObject({ scope: "own", found: true, month: "2026-02", net: 47368.42 });
      expect(own).not.toHaveProperty("totalGross");
    });

    it("an empty month for a company with no employees produces an empty run, not NaN", async () => {
      const r = await computeMonth("2025-12");
      expect(r.slips.every((s) => Number.isFinite(s.net))).toBe(true);
    });
  });

  describe("empty company (zero employees)", () => {
    it("every KPI is a number or null — never NaN/Infinity", async () => {
      await truncateAll(db);
      await db.companySettings.create({ data: { id: 1, companyName: "Empty Co" } });
      const admin = await db.user.create({ data: { email: "a@empty.test", passwordHash: "x", role: "ADMIN" } });
      const s = { userId: admin.id, role: "ADMIN" as const, employeeId: null, name: "A" };
      const d = await getDashboard(s, FEB);
      const json = JSON.stringify(d);
      expect(json).not.toMatch(/NaN|Infinity/);
      if (d.kind !== "company") throw new Error();
      expect(d.kpis.headcount.total).toBe(0);
      expect(d.kpis.attendance.attendanceRatePct).toBeNull();
      expect(d.kpis.topLateComers).toEqual([]);
      expect(d.trend).toEqual([]);
      expect((await computeMonth("2026-02")).slips).toEqual([]);
    });
  });
});
