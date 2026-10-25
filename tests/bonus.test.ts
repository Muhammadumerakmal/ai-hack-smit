import { describe, expect, it } from "vitest";
import { addDays, weekdayOf } from "@/lib/dates";
import { descriptorSchema, faceDistance, FACE_MATCH_THRESHOLD, isSameFace } from "@/lib/face";
import { haversineMeters } from "@/lib/geo";
import type { DayRow, DayStatus } from "@/server/services/attendance.service";
import { checkInSchema, evaluateCameraCheckIn } from "@/server/services/attendance.service";
import { detectAnomalies, scoreAttritionRisk } from "@/server/services/insights.service";
import { computePay, latePenaltyDays } from "@/server/services/payroll.service";

// Pure rules behind the bonus features: camera geofence, late penalty, attrition risk, absence anomalies.

const OFFICE = { officeLat: 24.8607, officeLng: 67.0011, radiusMeters: 150 };
const camera = (o: Partial<{ lat: number; lng: number; accuracy: number; faces: number; liveness: boolean }> = {}) => ({
  method: "camera" as const,
  lat: 24.861,
  lng: 67.0011,
  accuracy: 20,
  faces: 1,
  liveness: true,
  ...o,
});

describe("geofence (Haversine)", () => {
  it("measures known distances", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    // 1° of latitude is about 111.2 km
    expect(haversineMeters({ lat: 24, lng: 67 }, { lat: 25, lng: 67 })).toBeCloseTo(111_195, -2);
    // Karachi → Lahore is roughly 1,030 km
    expect(haversineMeters({ lat: 24.8607, lng: 67.0011 }, { lat: 31.5204, lng: 74.3587 }) / 1000).toBeCloseTo(1030, -1);
  });

  it("accepts one face, a blink, good GPS, inside the radius", () => {
    const r = evaluateCameraCheckIn(camera(), OFFICE);
    expect(r.distanceMeters).toBeGreaterThan(25);
    expect(r.distanceMeters).toBeLessThan(40);
    expect(r.gpsAccuracy).toBe(20);
  });

  it.each([
    ["no face", camera({ faces: 0 }), /No face/],
    ["two faces", camera({ faces: 2 }), /More than one face/],
    ["no blink", camera({ liveness: false }), /blink/],
    ["GPS worse than 100 m", camera({ accuracy: 101 }), /too imprecise/],
    ["outside the radius", camera({ lat: 24.87 }), /m from the office/],
  ])("rejects %s with 422", (_label, input, message) => {
    expect(() => evaluateCameraCheckIn(input, OFFICE)).toThrow(message);
    try {
      evaluateCameraCheckIn(input, OFFICE);
    } catch (e) {
      expect(e).toMatchObject({ status: 422, code: "camera_rejected" });
    }
  });

  it("refuses when Admin has not set the office location", () => {
    expect(() => evaluateCameraCheckIn(camera(), { officeLat: null, officeLng: null, radiusMeters: 150 })).toThrow(/office location/);
  });

  it("a body without a method is a web check-in; camera fields are required for camera", () => {
    expect(checkInSchema.parse({})).toEqual({ method: "web" });
    expect(checkInSchema.safeParse({ method: "camera", lat: 24.8 }).success).toBe(false);
    expect(checkInSchema.safeParse(camera()).success).toBe(true);
  });
});

describe("face matching (descriptor distance)", () => {
  const a = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 4);
  const nudge = (d: number[], by: number) => d.map((x, i) => x + (i % 2 ? by : -by));

  it("measures Euclidean distance between descriptors", () => {
    expect(faceDistance(a, a)).toBe(0);
    expect(faceDistance(a, nudge(a, 0.01))).toBeCloseTo(Math.sqrt(128) * 0.01, 6);
    expect(faceDistance(a, a.slice(1))).toBe(Infinity);
  });

  it("matches the same face within the threshold and refuses a different one", () => {
    expect(FACE_MATCH_THRESHOLD).toBe(0.55);
    expect(isSameFace(a, nudge(a, 0.02))).toBe(true); // about 0.23
    expect(isSameFace(a, nudge(a, 0.06))).toBe(false); // about 0.68
  });

  it("accepts only 128 finite numbers", () => {
    expect(descriptorSchema.safeParse(a).success).toBe(true);
    expect(descriptorSchema.safeParse(a.slice(1)).success).toBe(false);
    expect(descriptorSchema.safeParse([...a.slice(1), Number.NaN]).success).toBe(false);
    expect(descriptorSchema.safeParse([...a.slice(1), 99]).success).toBe(false);
  });
});

describe("late penalty (3 lates = 0.5 day)", () => {
  it("counts whole groups of three", () => {
    expect([0, 1, 2, 3, 5, 6, 7, 9].map(latePenaltyDays)).toEqual([0, 0, 0, 0.5, 0.5, 1, 1, 1.5]);
  });

  it("is deducted like any other unpaid day", () => {
    const base = { basic: 100_000, workingDays: 20, absentDays: 0, unpaidLeaveDays: 0, halfDays: 0, daysNotEmployed: 0 };
    const p = computePay({ ...base, latePenaltyDays: 1 });
    expect(p).toMatchObject({ perDay: 7_500, deductedDays: 1, deductions: 7_500, paidDays: 19 });
    expect(computePay(base).deductions).toBe(0); // off → no change to the Section 3 formula
  });
});

// ---------- insights ----------

const MONDAY = "2026-09-07";
/** n consecutive weekdays (Mon–Fri) from a Monday */
function weekdays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let d = from; out.length < n; d = addDays(d, 1)) if (![0, 6].includes(weekdayOf(d))) out.push(d);
  return out;
}
const isWeekend = (d: string) => [0, 6].includes(weekdayOf(d));
const row = (who: string, date: string, status: DayStatus): DayRow => ({ employeeId: who, name: who, code: who, department: "Eng", date, status });

describe("attrition risk score", () => {
  const days = weekdays("2026-06-01", 60);
  const recentStart = days[40];

  it("needs at least 5 working days of history", () => {
    expect(scoreAttritionRisk({ rows: days.slice(0, 4).map((d) => row("a", d, "present")), recentStart, unpaidLeaveDays: 0, tenureDays: 900 })).toBeNull();
  });

  it("a steady, long-serving employee is low risk with no factors", () => {
    const r = scoreAttritionRisk({ rows: days.map((d) => row("a", d, "present")), recentStart, unpaidLeaveDays: 0, tenureDays: 900 })!;
    expect(r).toEqual({ score: 0, level: "low", factors: [] });
  });

  it("late before, absent lately: high risk, reasons ranked by weight", () => {
    const rows = days.map((d) => row("b", d, d >= recentStart ? "absent" : "late"));
    const r = scoreAttritionRisk({ rows, recentStart, unpaidLeaveDays: 0, tenureDays: 900 })!;
    expect(r.level).toBe("high");
    expect(r.factors.map((f) => f.factor)).toEqual(["absenteeism", "lateness", "rising_absence"]);
    expect(r.score).toBe(70); // 30 + 20 + 20
    expect(r.factors[0].detail).toBe("Absent 20 of 60 working days (33.3%)");
  });

  it("tenure and unpaid leave add points; approved leave days are not counted as absence", () => {
    const rows = days.map((d, i) => row("c", d, i < 3 ? "on_leave" : "present"));
    const r = scoreAttritionRisk({ rows, recentStart, unpaidLeaveDays: 3, tenureDays: 90 })!;
    expect(r.factors).toEqual([
      { factor: "unpaid_leave", points: 15, detail: "3 unpaid leave days" },
      { factor: "short_tenure", points: 15, detail: "Joined 90 days ago (under 6 months)" },
    ]);
    expect(r).toMatchObject({ score: 30, level: "low" });
  });
});

describe("absence anomaly flags", () => {
  const two = weekdays(MONDAY, 10); // Mon 7 … Fri 18 Sep

  it("flags 3+ working days absent in a row, across a weekend", () => {
    // Thu, Fri, (weekend), Mon absent → 3 consecutive working days
    const rows = two.map((d, i) => row("a", d, [3, 4, 5].includes(i) ? "absent" : "present"));
    const flags = detectAnomalies(rows, isWeekend).filter((f) => f.kind === "consecutive_absence");
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ severity: "medium", dates: [two[3], two[4], two[5]] });
    expect(flags[0].detail).toBe(`Absent 3 working days in a row (${two[3]} to ${two[5]}) with no approved leave`);
  });

  it("5 in a row is high; leave or a present day breaks the run", () => {
    expect(detectAnomalies(two.slice(0, 5).map((d) => row("a", d, "absent")), isWeekend)[0]).toMatchObject({ kind: "consecutive_absence", severity: "high" });
    const broken = two.slice(0, 5).map((d, i) => row("a", d, i === 2 ? "on_leave" : "absent"));
    expect(detectAnomalies(broken, isWeekend).filter((f) => f.kind === "consecutive_absence")).toEqual([]);
  });

  it("flags absences that stretch weekends (Mondays / Fridays)", () => {
    const rows = two.map((d, i) => row("a", d, i === 0 || i === 9 ? "absent" : "present")); // Mon 7th, Fri 18th
    const f = detectAnomalies(rows, isWeekend);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "weekend_bridge", dates: [two[0], two[9]], detail: "2 absences next to a weekend or holiday" });
  });

  it("flags repeated missing check-outs", () => {
    const rows = two.map((d, i) => row("a", d, i % 3 === 1 ? "missing_checkout" : "present"));
    expect(detectAnomalies(rows, isWeekend).map((f) => f.kind)).toEqual(["missing_checkouts"]);
  });

  it("flags someone absent far more than the group, but not a whole group absent together", () => {
    const mid = two.slice(1, 4); // Tue–Thu: no bridge, but consecutive
    const rows = [
      ...two.map((d) => row("steady", d, "present")),
      ...two.map((d) => row("other", d, "present")),
      ...two.map((d) => row("away", d, mid.includes(d) ? "absent" : "present")),
    ];
    const kinds = detectAnomalies(rows, isWeekend).map((f) => `${f.employeeId}:${f.kind}`);
    expect(kinds.sort()).toEqual(["away:absence_outlier", "away:consecutive_absence"]);

    const everyone = ["x", "y"].flatMap((w) => mid.map((d) => row(w, d, "absent")));
    expect(detectAnomalies(everyone, isWeekend).map((f) => f.kind)).not.toContain("absence_outlier");
  });

  it("ignores today's not-yet-checked-in rows", () => {
    expect(detectAnomalies(two.slice(0, 4).map((d) => row("a", d, "not_checked_in")), isWeekend)).toEqual([]);
  });
});
