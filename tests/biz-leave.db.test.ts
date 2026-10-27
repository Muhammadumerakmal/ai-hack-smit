import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "@/lib/session";
import { decideCorrection, requestCorrection } from "@/server/services/attendance.service";
import { applyForLeave, cancelLeave, decideLeave, getLeaveBalance, previewLeave } from "@/server/services/leave.service";
import { createOrRecomputeDraft, finalizeRun, getRun } from "@/server/services/payroll.service";
import { importEmployeesCsv } from "@/server/services/people.service";
import { buildFebCompany } from "./biz-fixtures";
import { hasDb } from "./helpers";

// QA-3: leave balances, cross-year attribution, overlap edges, races and transaction rollback.
// All leave dates are after "today" (Oct 2026) because past-dated leave is refused.

describe.skipIf(!hasDb)("QA-3 leave rules, races and integrity", () => {
  const db = new PrismaClient();
  let fx: Awaited<ReturnType<typeof buildFebCompany>>;
  const bal = async (who: Session, type: string, year = 2026) => (await getLeaveBalance(who, { year })).balances.find((b) => b.type === type)!;
  /** Independent: approved working days straight from SQL. */
  const sqlApproved = async (employeeId: string, code: string) => {
    const [r] = await db.$queryRaw<{ days: bigint | null }[]>`
      SELECT SUM(l.days) AS days FROM leave_requests l JOIN leave_types t ON t.id = l."leaveTypeId"
      WHERE l."employeeId" = ${employeeId} AND t.code = ${code} AND l.status = 'APPROVED'`;
    return Number(r.days ?? 0);
  };

  beforeAll(async () => {
    fx = await buildFebCompany(db);
  });
  afterAll(() => db.$disconnect());

  describe("balances: only APPROVED reduces them", () => {
    let first: string;
    it("pending does not reduce the balance", async () => {
      first = (await applyForLeave(fx.as.A, { type: "sick", start: "2026-11-02", end: "2026-11-03", reason: "Flu" })).id;
      expect(await bal(fx.as.A, "sick")).toMatchObject({ quota: 8, usedApproved: 0, pending: 2, remaining: 8 });
    });

    it("approval reduces it; matches SQL", async () => {
      await decideLeave(fx.hr, first, { decision: "APPROVED" });
      expect(await bal(fx.as.A, "sick")).toMatchObject({ usedApproved: 2, pending: 0, remaining: 6 });
      expect(await sqlApproved(fx.emp.A.id, "sick")).toBe(2);
    });

    it("rejected and cancelled requests never count", async () => {
      const r = await applyForLeave(fx.as.A, { type: "sick", start: "2026-11-09", end: "2026-11-09", reason: "x" });
      await decideLeave(fx.hr, r.id, { decision: "REJECTED", comment: "Busy week" });
      const c = await applyForLeave(fx.as.A, { type: "sick", start: "2026-11-16", end: "2026-11-17", reason: "x" });
      await cancelLeave(fx.as.A, c.id);
      expect(await bal(fx.as.A, "sick")).toMatchObject({ usedApproved: 2, pending: 0, remaining: 6 });
    });

    it("cancelling approved future leave gives the days back", async () => {
      await cancelLeave(fx.as.A, first);
      expect(await bal(fx.as.A, "sick")).toMatchObject({ usedApproved: 0, remaining: 8 });
      expect(await sqlApproved(fx.emp.A.id, "sick")).toBe(0);
    });

    it("a second cancel of the same request is a 409, not a silent double audit", async () => {
      await expect(cancelLeave(fx.as.A, first)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("working days, holidays and overlap edges", () => {
    it("a leave spanning a weekend and a holiday counts only working days", async () => {
      await db.holiday.create({ data: { companyId: 1, date: new Date("2026-11-11T00:00:00Z"), name: "Iqbal Day" } });
      const p = await previewLeave(fx.as.E, { type: "casual", start: "2026-11-09", end: "2026-11-15", reason: "x" });
      expect(p.dates).toEqual(["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13"]); // Mon Tue (Wed holiday) Thu Fri
      expect(p.notes.join(" ")).toMatch(/2026-11-11/);
    });

    it("dates are inclusive: touching an existing leave is an overlap, the day after is not", async () => {
      await applyForLeave(fx.as.E, { type: "annual", start: "2026-11-23", end: "2026-11-24", reason: "x" });
      await expect(applyForLeave(fx.as.E, { type: "annual", start: "2026-11-24", end: "2026-11-25", reason: "x" })).rejects.toMatchObject({ status: 422 });
      await expect(applyForLeave(fx.as.E, { type: "annual", start: "2026-11-25", end: "2026-11-26", reason: "x" })).resolves.toMatchObject({ days: 2 });
    });

    it("a request with only weekend days is refused", async () => {
      await expect(applyForLeave(fx.as.E, { type: "casual", start: "2026-11-28", end: "2026-11-29", reason: "x" })).rejects.toMatchObject({ status: 422 });
    });
  });

  describe("leave across New Year is split by calendar year", () => {
    it("30 Dec – 2 Jan = 3 working days: 2 charged to 2026, 1 to 2027", async () => {
      const p = await previewLeave(fx.as.A, { type: "casual", start: "2026-12-30", end: "2027-01-02", reason: "Trip" });
      expect(p.workingDays).toBe(3);
      expect(p.notes.join(" ")).toMatch(/2 day\(s\) count against 2026.*1 day\(s\) count against 2027/);
      const r = await applyForLeave(fx.as.A, { type: "casual", start: "2026-12-30", end: "2027-01-02", reason: "Trip" });
      await decideLeave(fx.hr, r.id, { decision: "APPROVED" });
      // 2026: 2 (February, fixture) + 2 = 4 used. 2027: 1 used.
      expect(await bal(fx.as.A, "casual", 2026)).toMatchObject({ usedApproved: 4, remaining: 6 });
      expect(await bal(fx.as.A, "casual", 2027)).toMatchObject({ usedApproved: 1, remaining: 9 });
    });

    it("each year's quota is checked separately", async () => {
      // E has used 9 of 10 casual days in 2026.
      const casual = fx.types.casual.id;
      await db.leaveRequest.create({
        data: { companyId: 1, employeeId: fx.emp.E.id, leaveTypeId: casual, startDate: new Date("2026-08-03T00:00:00Z"), endDate: new Date("2026-08-13T00:00:00Z"), days: 9, reason: "x", status: "APPROVED" },
      });
      // 31 Dec (2026) + 1 Jan (2027): 1 day each → fits.
      const ok = await previewLeave(fx.as.E, { type: "casual", start: "2026-12-31", end: "2027-01-01", reason: "x" });
      expect(ok.blocking).toEqual([]);
      // 30–31 Dec: 2 days in 2026 → only 1 left.
      const no = await previewLeave(fx.as.E, { type: "casual", start: "2026-12-30", end: "2026-12-31", reason: "x" });
      expect(no.blocking.join(" ")).toMatch(/Not enough Casual balance: 1 left, 2 requested/);
    });
  });

  describe("races", () => {
    /** A fresh employee with a login, so each race round starts from a clean balance. */
    let n = 0;
    const freshEmployee = async () => {
      n++;
      const u = await db.user.create({ data: { companyId: 1, email: `race${n}@qa.test`, passwordHash: "x", role: "EMPLOYEE" } });
      const e = await db.employee.create({
        data: { companyId: 1, code: `RACE${n}`, fullName: `Race ${n}`, email: `race${n}@qa.test`, departmentId: fx.depts.eng.id, joinDate: new Date("2025-01-01T00:00:00Z"), status: "ACTIVE", basicSalary: 1, userId: u.id },
      });
      return { id: e.id, session: { userId: u.id, companyId: 1, role: "EMPLOYEE" as const, employeeId: e.id, name: e.fullName } };
    };

    it("stress (5 rounds): approvals that together exceed the balance never both succeed", async () => {
      for (let i = 0; i < 5; i++) {
        const emp = await freshEmployee();
        const pend = (s: string, e: string) =>
          db.leaveRequest.create({ data: { companyId: 1, employeeId: emp.id, leaveTypeId: fx.types.annual.id, startDate: new Date(`${s}T00:00:00Z`), endDate: new Date(`${e}T00:00:00Z`), days: 8, reason: "x" } });
        const [a, b] = [await pend("2026-11-30", "2026-12-09"), await pend("2026-12-14", "2026-12-23")];
        const r = await Promise.allSettled([decideLeave(fx.hr, a.id, { decision: "APPROVED" }), decideLeave(fx.hr2, b.id, { decision: "APPROVED" })]);
        expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
        expect(await sqlApproved(emp.id, "annual")).toBe(8);
      }
    });

    it("stress (5 rounds): a double-submitted leave is stored once", async () => {
      for (let i = 0; i < 5; i++) {
        const emp = await freshEmployee();
        const draft = { type: "sick", start: "2027-03-01", end: "2027-03-01", reason: "x" };
        const r = await Promise.allSettled([applyForLeave(emp.session, draft), applyForLeave(emp.session, draft)]);
        expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
        expect(await db.leaveRequest.count({ where: { employeeId: emp.id } })).toBe(1);
      }
    });

    it("two HR users approving two requests that together exceed the balance: only one succeeds", async () => {
      // E: annual quota 14, 0 approved. Two pending requests of 8 working days each.
      const r1 = await applyForLeave(fx.as.E, { type: "annual", start: "2026-11-30", end: "2026-12-09", reason: "a" });
      const r2 = await applyForLeave(fx.as.E, { type: "annual", start: "2026-12-14", end: "2026-12-23", reason: "b" });
      expect([r1.days, r2.days]).toEqual([8, 8]);
      const results = await Promise.allSettled([
        decideLeave(fx.hr, r1.id, { decision: "APPROVED" }),
        decideLeave(fx.hr2, r2.id, { decision: "APPROVED" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 422 } });
      expect(await sqlApproved(fx.emp.E.id, "annual")).toBe(8);
      expect((await bal(fx.as.E, "annual")).remaining).toBe(6);
    });

    it("the same request approved twice at once: one 200, one 409, one audit entry", async () => {
      const r = await applyForLeave(fx.as.E, { type: "sick", start: "2027-02-01", end: "2027-02-02", reason: "x" });
      const results = await Promise.allSettled([decideLeave(fx.hr, r.id, { decision: "APPROVED" }), decideLeave(fx.hr2, r.id, { decision: "APPROVED" })]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(results.find((x) => x.status === "rejected")).toMatchObject({ reason: { status: 409 } });
      expect(await db.auditLog.count({ where: { entity: "leave_request", entityId: r.id, action: "approve" } })).toBe(1);
    });

    it("double-submitting the same leave creates one request", async () => {
      const draft = { type: "sick", start: "2027-03-01", end: "2027-03-01", reason: "x" };
      const results = await Promise.allSettled([applyForLeave(fx.as.A, draft), applyForLeave(fx.as.A, draft)]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(await db.leaveRequest.count({ where: { employeeId: fx.emp.A.id, startDate: new Date("2027-03-01T00:00:00Z") } })).toBe(1);
    });

    it("an attendance correction decided twice at once is applied once", async () => {
      const c = await requestCorrection(fx.as.A, { date: "2026-02-06", checkIn: "09:05", checkOut: "17:00", reason: "Forgot to check in" });
      const results = await Promise.allSettled([decideCorrection(fx.hr, c.id, { approve: true }), decideCorrection(fx.hr2, c.id, { approve: false, comment: "No" })]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(results.find((x) => x.status === "rejected")).toMatchObject({ reason: { status: 409 } });
      const decided = await db.auditLog.count({ where: { entity: "attendance_correction", entityId: c.id, action: { in: ["approve", "reject"] } } });
      expect(decided).toBe(1);
    });

    it("payroll recompute racing finalize never leaves a finalized run half-replaced", async () => {
      for (const month of ["2026-03", "2026-04", "2026-05"]) {
        await createOrRecomputeDraft(fx.hr, month);
        const results = await Promise.allSettled([createOrRecomputeDraft(fx.hr, month), finalizeRun(fx.admin, month)]);
        for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
        const run = await getRun(fx.hr, month);
        expect(run.status).toBe("FINALIZED");
        const expected = (await db.payrollRun.findUniqueOrThrow({ where: { companyId_month: { companyId: 1, month } }, include: { _count: { select: { payslips: true } } } }))._count.payslips;
        expect(run.payslips.length).toBe(expected);
        expect(run.payslips.length).toBeGreaterThan(0);
        await expect(createOrRecomputeDraft(fx.hr, month)).rejects.toMatchObject({ status: 409 });
      }
    });
  });

  describe("transactions roll back completely", () => {
    const failOnAudit = async (action: string, fn: () => Promise<unknown>) => {
      await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa3_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'qa3 injected failure'; END $$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER qa3_fail BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = '${action}') EXECUTE FUNCTION qa3_fail()`);
      try {
        await expect(fn()).rejects.toThrow(/qa3 injected failure/);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa3_fail ON audit_logs`);
      }
    };

    it("CSV import: a failure at the end leaves no users or employees behind", async () => {
      const [users, emps] = [await db.user.count(), await db.employee.count()];
      const csv = "code,full_name,email,department,join_date,basic_salary\nX1,X One,x1@qa.test,Engineering,2026-10-01,100\nX2,X Two,x2@qa.test,Sales,2026-10-01,200\n";
      await failOnAudit("import", () => importEmployeesCsv(fx.hr, csv, false));
      expect([await db.user.count(), await db.employee.count()]).toEqual([users, emps]);
    });

    it("payroll recompute: a failure keeps the previous draft payslips intact", async () => {
      await createOrRecomputeDraft(fx.hr, "2026-06");
      const before = (await getRun(fx.hr, "2026-06")).payslips.map((p) => p.id).sort();
      await failOnAudit("recompute", () => createOrRecomputeDraft(fx.hr, "2026-06"));
      expect((await getRun(fx.hr, "2026-06")).payslips.map((p) => p.id).sort()).toEqual(before);
    });
  });
});
