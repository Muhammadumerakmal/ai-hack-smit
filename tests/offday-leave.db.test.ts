import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, toDate, todayIso, weekdayOf } from "@/lib/dates";
import type { Session } from "@/lib/session";
import { runTool } from "@/server/ai/tools";
import { dateContext } from "@/server/ai/policy";
import { getEmployeeDashboard } from "@/server/services/analytics.service";
import { getBoard, getTodaySnapshot } from "@/server/services/attendance.service";
import { applyForLeave, getLeaveSummary } from "@/server/services/leave.service";
import { hasDb, seed, sessionFor } from "./helpers";

// Session 08: check-ins on a weekend/holiday count for "today", "who is on leave" covers future periods,
// and the employee dashboard has hours per day.
describe.skipIf(!hasDb)("off-day check-ins, leave in a period, week bars", () => {
  const db = new PrismaClient();
  let hr: Session, ali: Session, sara: Session;
  const today = todayIso();

  beforeAll(async () => {
    await seed(db);
    [hr, ali, sara] = await Promise.all(["hr@demo.test", "ali@demo.test", "sara@demo.test"].map((e) => sessionFor(db, e)));
  });
  afterAll(() => db.$disconnect());

  describe("today is not a working day", () => {
    beforeAll(async () => {
      // Make today a weekend whatever weekday the suite runs on, with exactly one check-in (Ali, late).
      await db.companySettings.update({ where: { id: 1 }, data: { weekendDays: [weekdayOf(today)] } });
      await db.leaveRequest.deleteMany({ where: { startDate: { lte: toDate(today) }, endDate: { gte: toDate(today) } } });
      await db.attendance.deleteMany({ where: { date: toDate(today) } });
      await db.attendance.create({
        data: { companyId: 1, employeeId: ali.employeeId!, date: toDate(today), checkIn: new Date(), status: "LATE", source: "web" },
      });
    });
    afterAll(() => db.companySettings.update({ where: { id: 1 }, data: { weekendDays: [0, 6] } }));

    it("the today snapshot counts the check-in although there are no working-day rows", async () => {
      expect(await getTodaySnapshot()).toMatchObject({ date: today, present: 1, late: 1, onLeave: 0, notCheckedIn: 0 });
    });

    it("the daily board's summary agrees with the rows it lists", async () => {
      const board = await getBoard(hr, { date: today });
      expect(board.isWorkingDay).toBe(false);
      expect(board.rows.map((r) => [r.name, r.status])).toEqual([["Ali Raza", "late"]]);
      expect(board.summary).toMatchObject({ present: 0, late: 1, absent: 0, notCheckedIn: 0 });
    });

    it("the department filter applies to off-day check-ins too", async () => {
      const sales = await db.department.findFirstOrThrow({ where: { name: "Sales" } });
      expect(await getTodaySnapshot(sales.id)).toMatchObject({ present: 0, late: 0 });
    });
  });

  describe("who is on leave in a period", () => {
    // Next week Monday–Tuesday: always in the future and always two working days under a Sat–Sun weekend.
    const monday = addDays(today, 7 - ((weekdayOf(today) + 6) % 7));
    const tuesday = addDays(monday, 1);

    beforeAll(async () => {
      await db.leaveRequest.deleteMany({ where: { employeeId: sara.employeeId!, startDate: { gte: toDate(monday) } } });
      await db.holiday.deleteMany({ where: { date: { in: [toDate(monday), toDate(tuesday)] } } });
      const req = await applyForLeave(sara, { type: "casual", start: monday, end: tuesday, reason: "Sister's wedding" });
      await db.leaveRequest.update({ where: { id: req.id }, data: { status: "APPROVED" } });
    });

    it("lists approved leave inside a future period, with its working days there", async () => {
      const s = await getLeaveSummary(hr, { start: monday, end: addDays(monday, 6) });
      expect(s.onLeaveInPeriod).toContainEqual({ name: "Sara Ahmed", department: "Engineering", type: "casual", start: monday, end: tuesday, workingDaysInPeriod: 2 });
    });

    it("lists leave starting in the next 14 days, so 'who is on leave?' can mention it", async () => {
      const s = await getLeaveSummary(hr, { start: `${today.slice(0, 7)}-01`, end: today });
      expect(s.upcomingNext14Days).toContainEqual({ name: "Sara Ahmed", department: "Engineering", type: "casual", start: monday, end: tuesday });
    });

    it("an employee's summary never lists anyone else", async () => {
      const own = await getLeaveSummary(ali, { start: monday, end: addDays(monday, 6) });
      expect([...own.onLeaveInPeriod, ...own.upcomingNext14Days].map((l) => l.name)).not.toContain("Sara Ahmed");
    });

    it("the AI tool passes the same list through", async () => {
      const res = await runTool(hr, "get_leave_summary", JSON.stringify({ start: monday, end: addDays(monday, 6) }));
      expect(res.ok).toBe(true);
      expect(JSON.parse(res.content).onLeaveInPeriod.map((l: { name: string }) => l.name)).toContain("Sara Ahmed");
    });

    it("an overlapping request gets a grammatical refusal", async () => {
      await expect(applyForLeave(sara, { type: "casual", start: tuesday, end: tuesday, reason: "again" })).rejects.toMatchObject({
        status: 422,
        message: `You already have an approved leave from ${monday} to ${tuesday}.`,
      });
    });

    it("the chat prompt spells out this week and next week", () => {
      expect(dateContext()).toContain(`"next week" means ${monday} to ${addDays(monday, 6)}`);
    });
  });

  it("the employee dashboard returns hours for each day Monday to Sunday", async () => {
    const d = await getEmployeeDashboard(ali);
    expect(d.week.days).toHaveLength(7);
    expect(d.week.days[0].date).toBe(d.week.start);
    expect(weekdayOf(d.week.start)).toBe(1);
    expect(d.week.days.filter((x) => x.date > today).every((x) => x.future && x.hours === 0)).toBe(true);
    expect(d.week.days.reduce((n, x) => n + x.hours, 0)).toBeCloseTo(d.week.hours, 0);
  });
});
