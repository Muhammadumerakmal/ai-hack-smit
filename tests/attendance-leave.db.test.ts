import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, toDate, todayIso, weekdayOf } from "@/lib/dates";
import type { Session } from "@/lib/session";
import * as boardRoute from "@/app/api/attendance/board/route";
import * as calendarRoute from "@/app/api/attendance/calendar/route";
import * as checkInRoute from "@/app/api/attendance/check-in/route";
import * as checkOutRoute from "@/app/api/attendance/check-out/route";
import * as correctionDecisionRoute from "@/app/api/attendance/corrections/[id]/decision/route";
import * as correctionsRoute from "@/app/api/attendance/corrections/route";
import * as todayRoute from "@/app/api/attendance/today/route";
import * as leaveBalanceRoute from "@/app/api/leave-balance/route";
import * as leaveCancelRoute from "@/app/api/leave-requests/[id]/cancel/route";
import * as leaveDecisionRoute from "@/app/api/leave-requests/[id]/decision/route";
import * as leaveRoute from "@/app/api/leave-requests/route";
import { checkIn, checkOut, decideCorrection, getCalendar, requestCorrection } from "@/server/services/attendance.service";
import { applyForLeave, cancelLeave, decideLeave, getLeaveBalance } from "@/server/services/leave.service";
import { call, hasDb, seed, sessionFor } from "./helpers";

/** A weekday at least `minDaysAhead` from today (so tests never collide with seeded attendance). */
function futureWeekday(minDaysAhead: number, weekday = 1): string {
  let d = addDays(todayIso(), minDaysAhead);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}
/** Karachi wall-clock time on a date → the UTC instant (Asia/Karachi is UTC+5, no DST). */
const pk = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:00`);

describe.skipIf(!hasDb)("M4 attendance + M5 leave", () => {
  const db = new PrismaClient();
  let admin: Session, hr: Session, sara: Session, ali: Session, bilal: Session;

  beforeAll(async () => {
    await seed(db);
    [admin, hr, sara, ali, bilal] = await Promise.all(
      ["admin@demo.test", "hr@demo.test", "sara@demo.test", "ali@demo.test", "bilal@demo.test"].map((e) => sessionFor(db, e)),
    );
  });
  afterAll(() => db.$disconnect());

  describe("check-in / check-out rules", () => {
    const day = futureWeekday(40, 2);

    it("on time up to 09:15, late after", async () => {
      const ontime = await checkIn(sara, pk(day, "09:15"));
      expect(ontime.status).toBe("PRESENT");
      const late = await checkIn(ali, pk(day, "09:16"));
      expect(late.status).toBe("LATE");
    });

    it("a second check-in the same day is a 409", async () => {
      await expect(checkIn(sara, pk(day, "10:00"))).rejects.toMatchObject({ status: 409 });
    });

    it("check-out under 5 hours makes a half day; a full day keeps the status", async () => {
      expect((await checkOut(sara, pk(day, "13:00"))).status).toBe("HALF_DAY"); // 3h45m
      expect((await checkOut(ali, pk(day, "18:00"))).status).toBe("LATE");
    });

    it("cannot check out twice, or without checking in", async () => {
      await expect(checkOut(sara, pk(day, "17:00"))).rejects.toMatchObject({ status: 409 });
      await expect(checkOut(bilal, pk(day, "17:00"))).rejects.toMatchObject({ status: 400 });
    });

    it("uses settings changed later only for new records", async () => {
      await db.companySettings.update({ where: { id: 1 }, data: { officeStart: "10:00" } });
      try {
        const next = addDays(day, 1);
        expect((await checkIn(bilal, pk(next, "09:30"))).status).toBe("PRESENT");
        // Ali's earlier record stays LATE.
        const aliRec = await db.attendance.findFirstOrThrow({ where: { employeeId: ali.employeeId!, date: toDate(day) } });
        expect(aliRec.status).toBe("LATE");
      } finally {
        await db.companySettings.update({ where: { id: 1 }, data: { officeStart: "09:00" } });
      }
    });

    it("routes: check-in, 409 on repeat, today, check-out; Admin (no employee record) is refused", async () => {
      const first = await call(checkInRoute.POST, { userId: bilal.userId, body: {} });
      expect(first.status).toBe(200);
      expect((await call(checkInRoute.POST, { userId: bilal.userId, body: {} })).status).toBe(409);
      const today = await call(todayRoute.GET, { userId: bilal.userId });
      expect(today.body.record.status).toMatch(/PRESENT|LATE/);
      expect((await call(checkOutRoute.POST, { userId: bilal.userId, body: {} })).status).toBe(200);
      expect((await call(checkInRoute.POST, { userId: admin.userId, body: {} })).status).toBe(403);
      expect((await call(checkInRoute.POST, { body: {} })).status).toBe(401);
    });
  });

  describe("calendar and board", () => {
    it("employee sees own month; another employee's calendar is 403", async () => {
      const month = todayIso().slice(0, 7);
      const own = await call(calendarRoute.GET, { userId: sara.userId, url: `/api/attendance/calendar?month=${month}` });
      expect(own.status).toBe(200);
      expect(own.body.employee.id).toBe(sara.employeeId);
      expect(own.body.days.length).toBeGreaterThanOrEqual(28);
      const other = await call(calendarRoute.GET, { userId: sara.userId, url: `/api/attendance/calendar?month=${month}&employeeId=${ali.employeeId}` });
      expect(other.status).toBe(403);
    });

    it("calendar marks weekends and future days", async () => {
      const cal = await getCalendar(sara, { month: futureWeekday(40).slice(0, 7) });
      expect(cal.days.some((d) => d.kind === "weekend")).toBe(true);
      expect(cal.days.filter((d) => d.kind !== "weekend").every((d) => ["future", "holiday", "present", "half_day", "late"].includes(d.kind))).toBe(true);
    });

    it("board is HR/Admin only and lists every employee", async () => {
      const yesterday = addDays(todayIso(), -1);
      const res = await call(boardRoute.GET, { userId: hr.userId, url: `/api/attendance/board?date=${yesterday}` });
      expect(res.status).toBe(200);
      if (res.body.isWorkingDay) expect(res.body.rows.length).toBe(5);
      expect((await call(boardRoute.GET, { userId: sara.userId })).status).toBe(403);
    });
  });

  describe("attendance corrections", () => {
    const past = addDays(todayIso(), -45);

    it("employee requests, HR approves → attendance row created, employee notified, audited", async () => {
      const c = await requestCorrection(sara, { date: past, checkIn: "09:05", checkOut: "17:30", reason: "Forgot to check in" });
      expect(c.status).toBe("PENDING");
      await expect(requestCorrection(sara, { date: past, checkIn: "09:05", reason: "again" })).rejects.toMatchObject({ status: 409 });

      const res = await decideCorrection(hr, c.id, { approve: true, comment: "ok" });
      expect(res.attendance).toMatchObject({ status: "PRESENT", source: "correction" });
      const row = await db.attendance.findFirstOrThrow({ where: { employeeId: sara.employeeId!, date: toDate(past) } });
      expect(row.checkIn.toISOString()).toBe(pk(past, "09:05").toISOString());

      expect(await db.notification.count({ where: { userId: sara.userId, title: { contains: "approved" } } })).toBe(1);
      expect(await db.auditLog.count({ where: { entity: "attendance_correction", entityId: c.id, action: "approve" } })).toBe(1);
      await expect(decideCorrection(hr, c.id, { approve: true })).rejects.toMatchObject({ status: 409 });
    });

    it("rejects future dates and check-out before check-in", async () => {
      await expect(requestCorrection(sara, { date: addDays(todayIso(), 2), checkIn: "09:00", reason: "future" })).rejects.toMatchObject({ status: 400 });
      await expect(requestCorrection(sara, { date: addDays(past, -1), checkIn: "10:00", checkOut: "09:00", reason: "bad" })).rejects.toMatchObject({ status: 400 });
    });

    it("routes: Admin cannot decide (403), reject needs a comment (400), employee sees only own", async () => {
      const req = await call(correctionsRoute.POST, { userId: ali.userId, body: { date: addDays(past, -2), checkIn: "11:00", reason: "Was at a client" } });
      expect(req.status).toBe(200);
      const id = req.body.correction.id;
      expect((await call(correctionDecisionRoute.POST, { userId: admin.userId, params: { id }, body: { approve: true } })).status).toBe(403);
      expect((await call(correctionDecisionRoute.POST, { userId: hr.userId, params: { id }, body: { approve: false } })).status).toBe(400);
      const rej = await call(correctionDecisionRoute.POST, { userId: hr.userId, params: { id }, body: { approve: false, comment: "No proof" } });
      expect(rej.status).toBe(200);
      expect(rej.body.correction.status).toBe("REJECTED");

      const mine = await call(correctionsRoute.GET, { userId: sara.userId });
      expect(mine.body.items.every((c: { employeeId: string }) => c.employeeId === sara.employeeId)).toBe(true);
      const all = await call(correctionsRoute.GET, { userId: admin.userId });
      expect(all.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it("an approved late correction is stored as LATE", async () => {
      const c = await requestCorrection(bilal, { date: addDays(past, -3), checkIn: "09:40", checkOut: "18:00", reason: "Card reader down" });
      const res = await decideCorrection(hr, c.id, { approve: true });
      expect(res.attendance?.status).toBe("LATE");
    });
  });

  describe("leave approval workflow", () => {
    it("apply → HR approves → employee notified; balance drops", async () => {
      const mon = futureWeekday(60);
      const applied = await applyForLeave(sara, { type: "casual", start: mon, end: addDays(mon, 1), reason: "Wedding" });
      expect(applied.status).toBe("PENDING");
      expect(await db.notification.count({ where: { userId: hr.userId, title: "New leave request" } })).toBeGreaterThanOrEqual(1);

      const before = (await getLeaveBalance(sara)).balances.find((b) => b.type === "casual")!;
      const res = await call(leaveDecisionRoute.POST, { userId: hr.userId, params: { id: applied.id }, body: { decision: "APPROVED" } });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("APPROVED");
      const after = (await getLeaveBalance(sara)).balances.find((b) => b.type === "casual")!;
      expect(after.remaining).toBe(before.remaining! - 2);
      expect(await db.notification.count({ where: { userId: sara.userId, title: "Leave approved" } })).toBe(1);
      expect(await db.auditLog.count({ where: { entity: "leave_request", entityId: applied.id, action: "approve" } })).toBe(1);
    });

    it("reject needs a comment (400); Admin cannot decide (403); decided requests are 409", async () => {
      const mon = futureWeekday(75);
      const applied = await applyForLeave(ali, { type: "annual", start: mon, end: mon, reason: "Trip" });
      expect((await call(leaveDecisionRoute.POST, { userId: hr.userId, params: { id: applied.id }, body: { decision: "REJECTED" } })).status).toBe(400);
      expect((await call(leaveDecisionRoute.POST, { userId: admin.userId, params: { id: applied.id }, body: { decision: "APPROVED" } })).status).toBe(403);
      const rej = await call(leaveDecisionRoute.POST, { userId: hr.userId, params: { id: applied.id }, body: { decision: "REJECTED", comment: "Busy week" } });
      expect(rej.body).toMatchObject({ status: "REJECTED", comment: "Busy week" });
      expect((await call(leaveDecisionRoute.POST, { userId: hr.userId, params: { id: applied.id }, body: { decision: "APPROVED" } })).status).toBe(409);
    });

    it("approving more than the remaining balance is a 422", async () => {
      // Created directly (as if other leave was approved after applying): 9 sick days, quota is 8 in any year.
      const start = futureWeekday(90);
      const sick = await db.leaveType.findUniqueOrThrow({ where: { companyId_code: { companyId: 1, code: "sick" } } });
      const l = await db.leaveRequest.create({
        data: { companyId: 1, employeeId: sara.employeeId!, leaveTypeId: sick.id, startDate: toDate(start), endDate: toDate(addDays(start, 11)), days: 9, reason: "Surgery" },
      });
      await expect(decideLeave(hr, l.id, { decision: "APPROVED" })).rejects.toMatchObject({ status: 422 });
    });

    it("HR cannot approve their own leave", async () => {
      const mon = futureWeekday(100);
      const own = await applyForLeave(hr, { type: "casual", start: mon, end: mon, reason: "Errand" });
      await expect(decideLeave(hr, own.id, { decision: "APPROVED" })).rejects.toMatchObject({ status: 403 });
    });

    it("cancel: owner only; pending or future approved; past approved is 409", async () => {
      const mon = futureWeekday(110);
      const applied = await applyForLeave(bilal, { type: "casual", start: mon, end: mon, reason: "Family" });
      expect((await call(leaveCancelRoute.POST, { userId: ali.userId, params: { id: applied.id }, body: {} })).status).toBe(403);
      const ok = await call(leaveCancelRoute.POST, { userId: bilal.userId, params: { id: applied.id }, body: {} });
      expect(ok.body.status).toBe("CANCELLED");

      const casual = await db.leaveType.findUniqueOrThrow({ where: { companyId_code: { companyId: 1, code: "casual" } } });
      const pastStart = addDays(todayIso(), -20);
      const pastLeave = await db.leaveRequest.create({
        data: { companyId: 1, employeeId: bilal.employeeId!, leaveTypeId: casual.id, startDate: toDate(pastStart), endDate: toDate(pastStart), days: 1, reason: "x", status: "APPROVED" },
      });
      await expect(cancelLeave(bilal, pastLeave.id)).rejects.toMatchObject({ status: 409 });
    });

    it("lists: employee sees own only, HR sees everyone; balance route is scoped", async () => {
      const mine = await call(leaveRoute.GET, { userId: sara.userId });
      expect(mine.body.items.length).toBeGreaterThan(0);
      expect(mine.body.items.every((l: { employeeId: string }) => l.employeeId === sara.employeeId)).toBe(true);
      const all = await call(leaveRoute.GET, { userId: hr.userId, url: "/api/leave-requests?status=PENDING" });
      expect(all.body.items.every((l: { status: string }) => l.status === "PENDING")).toBe(true);
      expect(new Set((await call(leaveRoute.GET, { userId: hr.userId })).body.items.map((l: { employeeId: string }) => l.employeeId)).size).toBeGreaterThan(1);

      expect((await call(leaveBalanceRoute.GET, { userId: sara.userId })).status).toBe(200);
      expect((await call(leaveBalanceRoute.GET, { userId: sara.userId, url: `/api/leave-balance?employeeId=${ali.employeeId}` })).status).toBe(403);
      expect((await call(leaveBalanceRoute.GET, { userId: hr.userId, url: `/api/leave-balance?employeeId=${ali.employeeId}` })).status).toBe(200);
    });
  });
});
