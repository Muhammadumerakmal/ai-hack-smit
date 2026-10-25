import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as checkInRoute from "@/app/api/attendance/check-in/route";
import * as faceRoute from "@/app/api/attendance/face/route";
import * as faceResetRoute from "@/app/api/employees/[id]/face/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as todayRoute from "@/app/api/attendance/today/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as settingsRoute from "@/app/api/org/settings/route";
import * as runRoute from "@/app/api/payroll/runs/[month]/route";
import * as runsRoute from "@/app/api/payroll/runs/route";
import { addDays, currentMonth, eachDay, monthRange, toDate, weekdayOf } from "@/lib/dates";
import type { Session } from "@/lib/session";
import { runTool } from "@/server/ai/tools";
import { getPeopleInsights } from "@/server/services/insights.service";
import { call, hasDb, seed, sessionFor } from "./helpers";

// Bonus features end to end: camera check-in through the route, the late penalty in a real payroll run,
// and the insights (attrition risk + anomalies) on the dashboard and through the AI tool, with role scope.

const h = (fn: unknown) => fn as Parameters<typeof call>[0];
const NEAR = { method: "camera", lat: 24.861, lng: 67.0011, accuracy: 15, faces: 1, liveness: true }; // ~33 m from the seeded office

describe.skipIf(!hasDb)("bonus features (DB + routes)", () => {
  const db = new PrismaClient();
  let ids: Record<string, string>;
  let admin: Session, hr: Session, ali: Session, sara: Session, bilal: Session, zara: Session;

  beforeAll(async () => {
    ids = (await seed(db)).employees;
    [admin, hr, ali, sara, bilal, zara] = await Promise.all(
      ["admin@demo.test", "hr@demo.test", "ali@demo.test", "sara@demo.test", "bilal@demo.test", "zara@demo.test"].map((e) => sessionFor(db, e)),
    );
  });
  afterAll(() => db.$disconnect());

  describe("camera check-in", () => {
    it("today tells the widget camera check-in is available, without the office coordinates", async () => {
      const r = await call(todayRoute.GET, { userId: sara.userId });
      expect(r.body.camera).toEqual({ available: true, required: false, radiusMeters: 150, maxAccuracyMeters: 100, faceEnrolled: false });
      expect(JSON.stringify(r.body)).not.toContain("24.86");
    });

    it("rejects two faces, poor GPS and a phone outside the radius with 422 and stores nothing", async () => {
      for (const body of [{ ...NEAR, faces: 2 }, { ...NEAR, accuracy: 250 }, { ...NEAR, lat: 24.9 }, { ...NEAR, liveness: false }]) {
        const r = await call(checkInRoute.POST, { userId: sara.userId, body });
        expect(r.status, JSON.stringify(body)).toBe(422);
        expect(r.body.message).toMatch(/attendance correction/);
      }
      expect(await db.attendance.count({ where: { employeeId: sara.employeeId!, source: "camera" } })).toBe(0);
    });

    it("accepts a good camera check-in: source camera, distance stored, no coordinates or photo", async () => {
      const r = await call(checkInRoute.POST, { userId: ali.userId, body: NEAR });
      expect(r.status).toBe(200);
      expect(r.body.record).toMatchObject({ source: "camera" });
      expect(r.body.record.distanceMeters).toBeGreaterThan(25);
      expect(r.body.record.distanceMeters).toBeLessThan(40);
      const row = await db.attendance.findFirstOrThrow({ where: { employeeId: ali.employeeId!, source: "camera" } });
      expect(row).toMatchObject({ gpsAccuracy: 15 });
      expect(Object.keys(row)).not.toContain("lat");
      // The server still stamps the time and still allows only one check-in per day.
      expect((await call(checkInRoute.POST, { userId: ali.userId, body: NEAR })).status).toBe(409);
    });

    it("Admin cannot require camera check-in before saving the office location", async () => {
      const base = { companyName: "Demo Co", officeStart: "09:00", graceMinutes: 15, halfDayHours: 5, weekendDays: [0, 6], radiusMeters: 150 };
      const bad = await call(settingsRoute.PUT, { userId: admin.userId, method: "PUT", body: { ...base, officeLat: null, officeLng: null, cameraRequired: true } });
      expect(bad.status).toBe(400);
      const ok = await call(settingsRoute.PUT, { userId: admin.userId, method: "PUT", body: { ...base, officeLat: 24.8607, officeLng: 67.0011, cameraRequired: true } });
      expect(ok.status).toBe(200);
      // HR can view the switch but not change it.
      expect((await call(settingsRoute.GET, { userId: hr.userId })).body).toMatchObject({ cameraRequired: true, latePenaltyEnabled: false });
    });

    it("when camera check-in is required, the plain web button is refused and the camera works", async () => {
      const web = await call(checkInRoute.POST, { userId: sara.userId, body: {} });
      expect(web.status).toBe(403);
      expect(web.body.error).toBe("camera_required");
      expect((await call(checkInRoute.POST, { userId: sara.userId, body: NEAR })).status).toBe(200);
      await db.companySettings.update({ where: { id: 1 }, data: { cameraRequired: false } });
    });
  });

  describe("face matching (enrolled face)", () => {
    const face = Array.from({ length: 128 }, (_, i) => Math.cos(i) / 4);
    const nudge = (by: number) => face.map((x, i) => x + (i % 2 ? by : -by));

    it("an employee enrols their face once; a second enrolment needs an HR reset", async () => {
      expect((await call(faceRoute.GET, { userId: zara.userId })).body).toEqual({ enrolled: false, enrolledAt: null });
      const r = await call(faceRoute.POST, { userId: zara.userId, body: { descriptor: face } });
      expect(r.status).toBe(200);
      expect(r.body.enrolled).toBe(true);
      expect((await call(faceRoute.POST, { userId: zara.userId, body: { descriptor: nudge(0.3) } })).status).toBe(409);
      expect((await call(faceRoute.POST, { userId: zara.userId, body: { descriptor: face.slice(1) } })).status).toBe(400);
      expect((await call(todayRoute.GET, { userId: zara.userId })).body.camera.faceEnrolled).toBe(true);
    });

    it("check-in: a different face or no descriptor is refused (422); the enrolled face passes", async () => {
      const other = await call(checkInRoute.POST, { userId: zara.userId, body: { ...NEAR, descriptor: nudge(0.06) } });
      expect(other.status).toBe(422);
      expect(other.body.message).toMatch(/does not match the face enrolled/);
      expect((await call(checkInRoute.POST, { userId: zara.userId, body: NEAR })).status).toBe(422);

      const ok = await call(checkInRoute.POST, { userId: zara.userId, body: { ...NEAR, descriptor: nudge(0.02) } });
      expect(ok.status).toBe(200);
      expect(ok.body.record).toMatchObject({ source: "camera", faceVerified: true });
    });

    it("with no enrolled face, camera check-in still works but is not face-verified", async () => {
      const r = await call(checkInRoute.POST, { userId: bilal.userId, body: { ...NEAR, descriptor: face } });
      expect(r.status).toBe(200);
      expect(r.body.record.faceVerified).toBeNull();
    });

    it("the descriptor never appears in Employee 360 or the audit log", async () => {
      const e360 = await call(h(employeeRoute.GET), { userId: hr.userId, params: { id: ids.E005 } });
      expect(e360.body.faceCheckIn.enrolled).toBe(true);
      expect(JSON.stringify(e360.body)).not.toContain("descriptor");
      const logs = await db.auditLog.findMany({ where: { action: { in: ["enroll_face", "reset_face"] } } });
      expect(logs.map((l) => l.action)).toContain("enroll_face");
      expect(JSON.stringify(logs)).not.toContain(String(face[3]));
    });

    it("HR resets the face (audited, employee notified); the employee and Admin cannot", async () => {
      const del = (userId: string) => call(h(faceResetRoute.DELETE), { userId, method: "DELETE", params: { id: ids.E005 } });
      expect((await del(zara.userId)).status).toBe(403);
      expect((await del(admin.userId)).status).toBe(403);
      expect((await del(hr.userId)).status).toBe(200);
      expect((await call(faceRoute.GET, { userId: zara.userId })).body.enrolled).toBe(false);
      expect(await db.auditLog.count({ where: { action: "reset_face", entityId: ids.E005 } })).toBe(1);
      expect(await db.notification.count({ where: { userId: zara.userId, title: "Face check-in reset" } })).toBe(1);
      expect((await del(hr.userId)).status).toBe(404);
    });
  });

  describe("late penalty in payroll", () => {
    // A past month with no seeded attendance: Ali gets exactly 7 late days and is absent on the rest.
    const month = addDays(monthRange(currentMonth()).start, -45).slice(0, 7);

    it("is off by default, and when on deducts 0.5 day per 3 lates (7 lates = 1 day)", async () => {
      const { start, end } = monthRange(month);
      const weekdays = eachDay(start, end).filter((d) => ![0, 6].includes(weekdayOf(d)));
      await db.attendance.createMany({
        data: weekdays.slice(0, 7).map((d) => ({
          employeeId: ids.E002,
          date: toDate(d),
          checkIn: new Date(`${d}T09:45:00+05:00`),
          checkOut: new Date(`${d}T18:00:00+05:00`),
          status: "LATE" as const,
        })),
      });

      const slip = async () => {
        expect((await call(runsRoute.POST, { userId: hr.userId, body: { month } })).status).toBe(200);
        const run = await call(h(runRoute.GET), { userId: hr.userId, params: { month } });
        return run.body.payslips.find((p: { code: string }) => p.code === "E002");
      };
      const off = await slip();
      expect(off).toMatchObject({ lateDays: 7, latePenaltyDays: 0, paidDays: 7 });

      await db.companySettings.update({ where: { id: 1 }, data: { latePenaltyEnabled: true } });
      const on = await slip(); // HR recomputes the same draft
      expect(on).toMatchObject({ lateDays: 7, latePenaltyDays: 1, paidDays: 6 });
      expect(on.deductions - off.deductions).toBeCloseTo(on.gross / on.workingDays, 1);
      await db.companySettings.update({ where: { id: 1 }, data: { latePenaltyEnabled: false } });
    });

    it("Section 7 payroll cost by month: the Admin dashboard and KPI JSON list each run's gross and net", async () => {
      const r = await call(dashboardRoute.GET, { userId: admin.userId });
      const row = r.body.admin.payrollTrend.find((x: { month: string }) => x.month === month);
      expect(row).toMatchObject({ month, status: "DRAFT", employees: 5 });
      const slips = await db.payslip.findMany({ where: { run: { month } } });
      expect(row.totalGross).toBeCloseTo(slips.reduce((n, s) => n + Number(s.gross), 0), 2);
      expect(row.totalNet).toBeCloseTo(slips.reduce((n, s) => n + Number(s.net), 0), 2);
      expect(r.body.kpis.payrollByMonth).toContainEqual({ month, status: "DRAFT", totalGross: row.totalGross, totalNet: row.totalNet });
      // The department filter applies: only the 2 Sales payslips.
      const sales = await call(dashboardRoute.GET, { userId: admin.userId, url: "/api/dashboard?department=Sales" });
      expect(sales.body.admin.payrollTrend.find((x: { month: string }) => x.month === month).employees).toBe(2);
      // The HR dashboard has no Admin payroll section.
      expect((await call(dashboardRoute.GET, { userId: hr.userId })).body.admin).toBeUndefined();
    });
  });

  describe("attrition risk and absence anomalies", () => {
    // 90 days of history ending two months ago, so the seeded current-month data stays out of it.
    const end = addDays(monthRange(currentMonth()).start, -32);
    const start = `${end.slice(0, 7)}-01`;
    const windowStart = addDays(end, -89);
    const recentStart = addDays(end, -29);

    beforeAll(async () => {
      const weekdays = eachDay(windowStart, end).filter((d) => ![0, 6].includes(weekdayOf(d)));
      const data = [];
      for (const [code, id] of Object.entries(ids)) {
        for (const d of weekdays) {
          if (code === "E004" && d >= recentStart) continue; // Bilal: absent for the last 30 days
          const late = code === "E004"; // …and late every day before that
          data.push({
            employeeId: id,
            date: toDate(d),
            checkIn: new Date(`${d}T${late ? "09:50" : "08:55"}:00+05:00`),
            checkOut: new Date(`${d}T18:00:00+05:00`),
            status: late ? ("LATE" as const) : ("PRESENT" as const),
          });
        }
      }
      await db.attendance.deleteMany({ where: { date: { gte: toDate(windowStart), lte: toDate(end) } } });
      await db.attendance.createMany({ data });
    });

    it("scores Bilal high risk with the reasons, everyone else low", async () => {
      const r = await getPeopleInsights(hr, { start, end });
      const [top, ...rest] = r.attritionRisk.employees;
      expect(top).toMatchObject({ code: "E004", level: "high" });
      expect(top.score).toBeGreaterThanOrEqual(60);
      expect(top.factors.map((f) => f.factor)).toEqual(expect.arrayContaining(["absenteeism", "lateness", "rising_absence"]));
      expect(rest.every((e) => e.level === "low")).toBe(true);
      expect(r.attritionRisk.counts.high).toBe(1);
    });

    it("flags only Bilal's absence pattern in the period", async () => {
      const r = await getPeopleInsights(hr, { start, end });
      expect(new Set(r.anomalies.flags.map((f) => f.code))).toEqual(new Set(["E004"]));
      expect(r.anomalies.flags.map((f) => f.kind)).toEqual(expect.arrayContaining(["consecutive_absence", "weekend_bridge", "absence_outlier"]));
      expect(r.anomalies.flags[0].severity).toBe("high");
    });

    it("the HR dashboard and the KPI JSON (AI summary input) carry the same insights", async () => {
      const r = await call(dashboardRoute.GET, { userId: hr.userId, url: `/api/dashboard?start=${start}&end=${end}` });
      expect(r.status).toBe(200);
      expect(r.body.insights.attritionRisk.employees[0].code).toBe("E004");
      expect(r.body.kpis.insights.attritionRisk).toMatchObject({ high: 1 });
      expect(r.body.kpis.insights.attritionRisk.top[0]).toMatchObject({ name: "Bilal Shah", level: "high" });
      expect(r.body.kpis.insights.absenceAnomalies.employeesFlagged).toBe(1);
    });

    it("the department filter applies", async () => {
      const eng = await getPeopleInsights(hr, { start, end, department: "Engineering" });
      expect(eng.attritionRisk.employees.map((e) => e.department)).not.toContain("Sales");
      expect(eng.anomalies.total).toBe(0);
    });

    it("AI tool: HR gets the insights; an employee is refused and sees no company insights on their dashboard", async () => {
      const ok = await runTool(hr, "get_people_insights", JSON.stringify({ start, end }));
      expect(ok.ok).toBe(true);
      expect(JSON.parse(ok.content).attritionRisk.employees[0].name).toBe("Bilal Shah");

      const no = await runTool(bilal, "get_people_insights", "{}");
      expect(JSON.parse(no.content).error).toBe("forbidden");
      await expect(getPeopleInsights(bilal, { start, end })).rejects.toMatchObject({ status: 403 });

      const personal = await call(dashboardRoute.GET, { userId: bilal.userId });
      expect(personal.body.kind).toBe("personal");
      expect(personal.body).not.toHaveProperty("insights");
    });
  });
});
