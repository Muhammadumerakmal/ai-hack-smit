import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, toDate, todayIso, weekdayOf } from "@/lib/dates";
import type { Session } from "@/lib/session";
import * as announcementsRoute from "@/app/api/announcements/route";
import * as auditRoute from "@/app/api/audit/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as readRoute from "@/app/api/notifications/read/route";
import { getAttendanceSummary } from "@/server/services/attendance.service";
import { getAttrition } from "@/server/services/analytics.service";
import { call, hasDb, seed, sessionFor } from "./helpers";

// Run alone: TEST_DATABASE_URL="postgresql://hcm:hcm@localhost:5432/hcm_d?schema=public" npx vitest run tests/dashboard-comms.db.test.ts
describe.skipIf(!hasDb)("M7 dashboards + M9 comms & audit", () => {
  const db = new PrismaClient();
  let admin: Session, hr: Session, sara: Session, ali: Session;
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;

  beforeAll(async () => {
    await seed(db);
    [admin, hr, sara, ali] = await Promise.all(["admin@demo.test", "hr@demo.test", "sara@demo.test", "ali@demo.test"].map((e) => sessionFor(db, e)));
  });
  afterAll(() => db.$disconnect());

  describe("GET /api/dashboard", () => {
    it("HR gets company KPIs that match the underlying services", async () => {
      const { status, body } = await call(dashboardRoute.GET, { userId: hr.userId, url: "/api/dashboard" });
      expect(status).toBe(200);
      expect(body.kind).toBe("company");
      expect(body.filters).toMatchObject({ start: monthStart, end: today });
      expect(body.kpis.headcount.total).toBe(5);
      expect(body.kpis.topLateComers[0].name).toBe("Ali Raza");
      const summary = await getAttendanceSummary(hr, { start: monthStart, end: today });
      expect(body.kpis.attendance.attendanceRatePct).toBe(summary.attendanceRatePct);
      expect(body.kpis.attendance.absenteeismPct).toBe(summary.absenteeismPct);
      expect(body.departments).toEqual(["Engineering", "Human Resources", "Sales"]);
      // Trend: one point per working day so far, all weekdays.
      expect(body.trend.length).toBeGreaterThan(0);
      for (const p of body.trend) expect([0, 6]).not.toContain(weekdayOf(p.date));
      // HR dashboard has no Admin-only payroll cost / attrition / audit feed.
      expect(body.admin).toBeUndefined();
      expect(body.kpis.payroll).toBeUndefined();
      expect(body.kpis.attrition).toBeUndefined();
    });

    it("counts pending leave and attendance corrections as approvals", async () => {
      await db.attendanceCorrection.create({
        data: { companyId: 1, employeeId: sara.employeeId!, date: toDate(addDays(today, -2)), requestedCheckIn: new Date(), reason: "forgot to check in" },
      });
      const { body } = await call(dashboardRoute.GET, { userId: hr.userId, url: "/api/dashboard" });
      expect(body.kpis.approvals).toEqual({ pendingLeave: 1, pendingAttendanceCorrections: 1, total: 2 });
      await db.attendanceCorrection.deleteMany();
    });

    it("filters by department", async () => {
      const { body } = await call(dashboardRoute.GET, { userId: hr.userId, url: "/api/dashboard?department=engineering" });
      expect(body.kpis.headcount.total).toBe(2);
      expect(body.kpis.topLateComers.every((l: { department: string }) => l.department === "Engineering")).toBe(true);
      expect(new Set(body.leaveUtilization.map((u: { department: string }) => u.department))).toEqual(new Set(["Engineering"]));
    });

    it("computes leave utilization per type and department", async () => {
      const { body } = await call(dashboardRoute.GET, { userId: hr.userId, url: `/api/dashboard?start=${today.slice(0, 4)}-01-01&end=${today}` });
      // Sara's 1 approved sick day (Feb) in Engineering: 1 ÷ (8 × 2 people) = 6.3 %
      const sick = body.leaveUtilization.find((u: { department: string; type: string }) => u.department === "Engineering" && u.type === "sick");
      expect(sick).toMatchObject({ days: 1, utilizationPct: 6.3 });
      const unpaid = body.leaveUtilization.find((u: { type: string }) => u.type === "unpaid");
      expect(unpaid.utilizationPct).toBeNull(); // unlimited quota
    });

    it("Admin also gets payroll cost, workforce mix, attrition and the audit feed", async () => {
      const { status, body } = await call(dashboardRoute.GET, { userId: admin.userId, url: "/api/dashboard" });
      expect(status).toBe(200);
      expect(body.admin.payrollCost).toMatchObject({ found: true, totalGross: 862500, employees: 5 });
      expect(body.admin.payrollCost.byDepartment.map((d: { name: string }) => d.name)).toContain("Engineering");
      expect(body.admin.workforce.tenure.reduce((n: number, t: { count: number }) => n + t.count, 0)).toBe(5);
      expect(Array.isArray(body.admin.auditFeed)).toBe(true);
      expect(body.kpis.attrition).toMatchObject({ exits: 0, attritionPct: 0 });
      expect(body.kpis.payroll).toMatchObject({ totalGross: 862500 });
    });

    it("attrition = exits ÷ average headcount × 100", async () => {
      const zara = await db.employee.findFirstOrThrow({ where: { code: "E005" } });
      const exitDay = addDays(today, -1);
      await db.employee.update({ where: { id: zara.id }, data: { exitDate: toDate(exitDay), status: "EXITED" } });
      const a = await getAttrition({ start: monthStart, end: today });
      // start: 5 on the books, end: 4 → average 4.5; 1 exit → 22.2 %
      expect(a).toMatchObject({ exits: 1, averageHeadcount: 4.5, attritionPct: 22.2 });
      await db.employee.update({ where: { id: zara.id }, data: { exitDate: null, status: "ACTIVE" } });
    });

    it("Employee gets only their personal dashboard, never company data", async () => {
      const { status, body } = await call(dashboardRoute.GET, { userId: sara.userId, url: "/api/dashboard?department=Engineering" });
      expect(status).toBe(200);
      expect(body.kind).toBe("personal");
      expect(body.kpis).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("Ali Raza");
      expect(body.leaveBalance.find((b: { type: string }) => b.type === "sick")).toMatchObject({ remaining: 7 });
      expect(body.lastPayslip).toMatchObject({ gross: 210000 });
      expect(body.week.target).toBe(40);

      // Hours this week = sum of check-in → check-out for this week's closed records.
      const weekStart = addDays(today, -((weekdayOf(today) + 6) % 7));
      const recs = await db.attendance.findMany({ where: { employeeId: sara.employeeId!, date: { gte: toDate(weekStart), lte: toDate(today) } } });
      const expected = recs.reduce((n, r) => n + (r.checkOut && r.checkOut > r.checkIn ? r.checkOut.getTime() - r.checkIn.getTime() : 0), 0) / 3_600_000;
      expect(body.week.hours).toBeCloseTo(Math.round(expected * 10) / 10, 1);
      // Late count this month matches the attendance service.
      expect(body.month.lateCount).toBe((await getAttendanceSummary(sara, { start: monthStart, end: today })).counts.late);
    });

    it("rejects bad filters", async () => {
      expect((await call(dashboardRoute.GET, { userId: hr.userId, url: "/api/dashboard?start=2026-13-01" })).status).toBe(400);
      expect((await call(dashboardRoute.GET, { userId: hr.userId, url: "/api/dashboard?start=2026-10-20&end=2026-10-01" })).status).toBe(400);
      expect((await call(dashboardRoute.GET, { userId: hr.userId, url: "/api/dashboard?department=Marketing" })).status).toBe(404);
      expect((await call(dashboardRoute.GET, { url: "/api/dashboard" })).status).toBe(401);
    });
  });

  describe("announcements and notifications", () => {
    it("employees cannot post", async () => {
      const r = await call(announcementsRoute.POST, { userId: sara.userId, body: { title: "Hello all", body: "x" } });
      expect(r.status).toBe(403);
    });

    it("HR posts; everyone else is notified; everyone can read", async () => {
      const r = await call(announcementsRoute.POST, { userId: hr.userId, body: { title: "Office closed Friday", body: "Maintenance work." } });
      expect(r.status).toBe(200);
      expect(r.body.notified).toBe(5); // admin + 4 employees, not the author

      const list = await call(announcementsRoute.GET, { userId: sara.userId, url: "/api/announcements" });
      expect(list.body.items[0]).toMatchObject({ title: "Office closed Friday", authorName: "Hina Khan" });

      const hrNotes = await call(notificationsRoute.GET, { userId: hr.userId });
      expect(hrNotes.body.unread).toBe(0);
      const saraNotes = await call(notificationsRoute.GET, { userId: sara.userId });
      expect(saraNotes.body.unread).toBe(1);
      expect(saraNotes.body.items[0]).toMatchObject({ title: "Announcement: Office closed Friday", link: "/announcements", readAt: null });
    });

    it("validates the post", async () => {
      expect((await call(announcementsRoute.POST, { userId: hr.userId, body: { title: "", body: "" } })).status).toBe(400);
    });

    it("marking read only touches the caller's own notifications", async () => {
      const aliNote = await db.notification.findFirstOrThrow({ where: { userId: ali.userId } });
      // Sara tries to mark Ali's notification: nothing happens.
      const bad = await call(readRoute.POST, { userId: sara.userId, body: { ids: [aliNote.id] } });
      expect(bad.body.marked).toBe(0);
      expect((await db.notification.findUniqueOrThrow({ where: { id: aliNote.id } })).readAt).toBeNull();

      const all = await call(readRoute.POST, { userId: sara.userId, body: {} });
      expect(all.body.marked).toBe(1);
      expect((await call(notificationsRoute.GET, { userId: sara.userId })).body.unread).toBe(0);
      expect((await call(notificationsRoute.GET, { userId: ali.userId })).body.unread).toBe(1);
    });
  });

  describe("audit log", () => {
    it("is Admin-only", async () => {
      expect((await call(auditRoute.GET, { userId: hr.userId, url: "/api/audit" })).status).toBe(403);
      expect((await call(auditRoute.GET, { userId: sara.userId, url: "/api/audit" })).status).toBe(403);
    });

    it("lists entries newest first, filtered and paged", async () => {
      for (let i = 0; i < 3; i++) await call(announcementsRoute.POST, { userId: admin.userId, body: { title: `Notice ${i}`, body: "x" } });
      const all = await call(auditRoute.GET, { userId: admin.userId, url: "/api/audit?entity=announcement&pageSize=2" });
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ page: 1, pageSize: 2, total: 4 });
      expect(all.body.items).toHaveLength(2);
      expect(all.body.items[0]).toMatchObject({ action: "create", entity: "announcement", actorRole: "ADMIN", after: { title: "Notice 2" } });
      expect(all.body.filters.entities).toContain("announcement");
      const page2 = await call(auditRoute.GET, { userId: admin.userId, url: "/api/audit?entity=announcement&pageSize=2&page=2" });
      expect(page2.body.items.map((x: { after: { title: string } }) => x.after.title)).toEqual(["Notice 0", "Office closed Friday"]);
    });

    it("has no way to change or delete entries", () => {
      const exported = Object.keys(auditRoute);
      expect(exported).not.toContain("PUT");
      expect(exported).not.toContain("PATCH");
      expect(exported).not.toContain("DELETE");
      expect(exported).not.toContain("POST");
    });
  });
});
