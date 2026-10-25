import { db } from "@/lib/db";
import { addDays, isWorkingDay, maxIso, minIso, toDate, toIso, todayIso } from "@/lib/dates";
import { assertRole, type Session } from "@/lib/session";
import { getDayRows, type DayRow } from "./attendance.service";
import { getHolidaySet, getSettings, resolveDepartmentId } from "./settings.service";

// Bonus insights (Section 8): attrition risk score and absence anomaly flags.
// Both are rules over the same day rows the dashboards and AI tools use, so every flag can be checked
// against the attendance calendar. They explain themselves with plain reasons; nothing here is a model guess.

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Days of history behind the attrition risk score, ending on the period end. */
export const RISK_WINDOW_DAYS = 90;
/** The most recent part of the window, compared with the earlier part to spot a rising absence trend. */
const RECENT_DAYS = 30;
/** Fewer expected working days than this and there is not enough history to score someone. */
const MIN_DAYS_FOR_SCORE = 5;

// ---------- Attrition risk (pure) ----------

export interface RiskFactor {
  factor: "absenteeism" | "lateness" | "rising_absence" | "unpaid_leave" | "short_tenure";
  points: number;
  detail: string;
}

export type RiskLevel = "high" | "medium" | "low";

export interface RiskInput {
  /** this employee's day rows over the risk window */
  rows: DayRow[];
  /** first day of the recent part of the window */
  recentStart: string;
  /** approved unpaid leave days inside the window */
  unpaidLeaveDays: number;
  /** calendar days since joining, on the window end */
  tenureDays: number;
}

/**
 * Score 0–100 from five weighted signals (weights sum to 100):
 * absenteeism (30) · lateness (20) · absence rising in the last 30 days (20) · unpaid leave (15) · tenure under a year (15).
 * high ≥ 60, medium ≥ 35. Returns null when there are too few working days to judge.
 */
export function scoreAttritionRisk(i: RiskInput): { score: number; level: RiskLevel; factors: RiskFactor[] } | null {
  const closed = i.rows.filter((r) => r.status !== "not_checked_in" && r.status !== "on_leave");
  if (closed.length < MIN_DAYS_FOR_SCORE) return null;

  const absent = closed.filter((r) => r.status === "absent").length;
  const late = closed.filter((r) => r.status === "late").length;
  const attended = closed.filter((r) => r.status !== "absent").length;
  const absenteeism = pct(absent, closed.length);
  const latePct = pct(late, attended);

  const recent = closed.filter((r) => r.date >= i.recentStart);
  const earlier = closed.filter((r) => r.date < i.recentStart);
  const recentAbs = recent.filter((r) => r.status === "absent").length;
  const recentRate = pct(recentAbs, recent.length);
  const earlierRate = pct(earlier.filter((r) => r.status === "absent").length, earlier.length);

  const factors: RiskFactor[] = [];
  const add = (factor: RiskFactor["factor"], points: number, detail: string) => {
    const p = Math.round(points);
    if (p > 0) factors.push({ factor, points: p, detail });
  };

  // 20% absenteeism or more scores the full 30.
  add("absenteeism", clamp(absenteeism * 1.5, 0, 30), `Absent ${absent} of ${closed.length} working days (${absenteeism}%)`);
  // Late on 30% or more of attended days scores the full 20.
  add("lateness", clamp((latePct * 2) / 3, 0, 20), `Late on ${late} of ${attended} days attended (${latePct}%)`);
  // Only meaningful with an earlier baseline (not for someone who joined this month) and at least 2 recent absences.
  if (earlier.length >= MIN_DAYS_FOR_SCORE && recentAbs >= 2 && recentRate > earlierRate) {
    add("rising_absence", clamp((recentRate - earlierRate) / 2, 0, 20), `Absence rose to ${recentRate}% in the last ${RECENT_DAYS} days from ${earlierRate}% before`);
  }
  add("unpaid_leave", clamp(i.unpaidLeaveDays * 5, 0, 15), `${i.unpaidLeaveDays} unpaid leave day${i.unpaidLeaveDays === 1 ? "" : "s"}`);
  if (i.tenureDays < 180) add("short_tenure", 15, `Joined ${i.tenureDays} days ago (under 6 months)`);
  else if (i.tenureDays < 365) add("short_tenure", 8, `Joined ${i.tenureDays} days ago (under a year)`);

  factors.sort((a, b) => b.points - a.points);
  const score = clamp(factors.reduce((n, f) => n + f.points, 0), 0, 100);
  return { score, level: score >= 60 ? "high" : score >= 35 ? "medium" : "low", factors };
}

// ---------- Absence anomalies (pure) ----------

export type AnomalyKind = "consecutive_absence" | "weekend_bridge" | "missing_checkouts" | "absence_outlier";

export interface AnomalyFlag {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  kind: AnomalyKind;
  severity: "high" | "medium";
  detail: string;
  dates: string[];
}

/**
 * Flags unusual absence patterns in already-loaded day rows (working days only):
 * - consecutive_absence: 3+ working days absent in a row with no approved leave (5+ is high)
 * - weekend_bridge: 2+ absences on the working day just before or after a weekend / holiday
 * - missing_checkouts: 3+ days checked in but never checked out
 * - absence_outlier: 3+ absent days and at least twice the group's absenteeism rate
 */
export function detectAnomalies(rows: DayRow[], isNonWorking: (iso: string) => boolean): AnomalyFlag[] {
  const byEmp = new Map<string, DayRow[]>();
  for (const r of rows) {
    if (r.status === "not_checked_in") continue;
    const list = byEmp.get(r.employeeId);
    if (list) list.push(r);
    else byEmp.set(r.employeeId, [r]);
  }

  let groupAbsent = 0;
  let groupExpected = 0;
  for (const list of byEmp.values()) {
    for (const r of list) {
      if (r.status === "on_leave") continue;
      groupExpected++;
      if (r.status === "absent") groupAbsent++;
    }
  }
  const groupRate = groupExpected ? groupAbsent / groupExpected : 0;

  const flags: AnomalyFlag[] = [];
  for (const list of byEmp.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const who = { employeeId: list[0].employeeId, name: list[0].name, code: list[0].code, department: list[0].department };
    const flag = (kind: AnomalyKind, severity: AnomalyFlag["severity"], detail: string, dates: string[]) =>
      flags.push({ ...who, kind, severity, detail, dates });

    // Consecutive rows are consecutive working days, so a run of "absent" rows is a run of missed working days.
    let run: string[] = [];
    const closeRun = () => {
      if (run.length >= 3) {
        flag(
          "consecutive_absence",
          run.length >= 5 ? "high" : "medium",
          `Absent ${run.length} working days in a row (${run[0]} to ${run[run.length - 1]}) with no approved leave`,
          run,
        );
      }
      run = [];
    };
    for (const r of list) {
      if (r.status === "absent") run.push(r.date);
      else closeRun();
    }
    closeRun();

    const absences = list.filter((r) => r.status === "absent").map((r) => r.date);
    const bridges = absences.filter((d) => isNonWorking(addDays(d, -1)) || isNonWorking(addDays(d, 1)));
    if (bridges.length >= 2) {
      flag("weekend_bridge", "medium", `${bridges.length} absences next to a weekend or holiday`, bridges);
    }

    const missing = list.filter((r) => r.status === "missing_checkout").map((r) => r.date);
    if (missing.length >= 3) flag("missing_checkouts", "medium", `Checked in but never checked out on ${missing.length} days`, missing);

    const expected = list.filter((r) => r.status !== "on_leave").length;
    const rate = expected ? absences.length / expected : 0;
    if (absences.length >= 3 && groupRate > 0 && rate >= 2 * groupRate && byEmp.size > 1) {
      flag(
        "absence_outlier",
        rate >= 3 * groupRate ? "high" : "medium",
        `Absenteeism ${pct(absences.length, expected)}% against ${pct(groupAbsent, groupExpected)}% for the group`,
        absences,
      );
    }
  }

  const sev = { high: 0, medium: 1 };
  return flags.sort((a, b) => sev[a.severity] - sev[b.severity] || b.dates.length - a.dates.length || a.name.localeCompare(b.name));
}

// ---------- Service ----------

export interface InsightsFilter {
  start: string;
  end: string;
  departmentId?: string;
}

/**
 * Attrition risk (last 90 days up to the period end) and absence anomalies (inside the period).
 * Pass `periodRows` when the caller already loaded the period's day rows (the dashboard does) to skip a scan.
 */
export async function computeInsights(f: InsightsFilter, periodRows?: DayRow[]) {
  const end = minIso(f.end, todayIso());
  const riskStart = addDays(end, -(RISK_WINDOW_DAYS - 1));
  const recentStart = addDays(end, -(RECENT_DAYS - 1));

  const rows = periodRows ?? (await getDayRows({ start: f.start, end: f.end, departmentId: f.departmentId }));
  // Reuse the period rows when they already cover the whole risk window.
  const riskRows =
    f.start <= riskStart && periodRows ? rows.filter((r) => r.date >= riskStart && r.date <= end) : await getDayRows({ start: riskStart, end, departmentId: f.departmentId });

  const [settings, holidays, staff, unpaid] = await Promise.all([
    getSettings(),
    // A day before the period start or after its end can be the weekend/holiday a bridge absence touches.
    getHolidaySet(addDays(minIso(f.start, riskStart), -1), addDays(maxIso(f.end, end), 1)),
    db.employee.findMany({
      where: { status: { in: ["ACTIVE", "PROBATION"] }, ...(f.departmentId && { departmentId: f.departmentId }) },
      select: { id: true, joinDate: true },
    }),
    db.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        leaveType: { isPaid: false },
        startDate: { lte: toDate(end) },
        endDate: { gte: toDate(riskStart) },
        ...(f.departmentId && { employee: { departmentId: f.departmentId } }),
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);
  const isNonWorking = (d: string) => !isWorkingDay(d, settings.weekendDays, holidays);

  // Unpaid leave days inside the window, counted from the day rows (working days only).
  const unpaidDays = new Map<string, number>();
  const rowsByEmp = new Map<string, DayRow[]>();
  for (const r of riskRows) {
    const list = rowsByEmp.get(r.employeeId);
    if (list) list.push(r);
    else rowsByEmp.set(r.employeeId, [r]);
  }
  for (const l of unpaid) {
    const from = toIso(l.startDate);
    const to = toIso(l.endDate);
    const n = (rowsByEmp.get(l.employeeId) ?? []).filter((r) => r.status === "on_leave" && r.date >= from && r.date <= to).length;
    unpaidDays.set(l.employeeId, (unpaidDays.get(l.employeeId) ?? 0) + n);
  }

  const endMs = toDate(end).getTime();
  const scored = staff
    .map((e) => {
      const empRows = rowsByEmp.get(e.id) ?? [];
      const s = scoreAttritionRisk({
        rows: empRows,
        recentStart,
        unpaidLeaveDays: unpaidDays.get(e.id) ?? 0,
        tenureDays: Math.max(0, Math.round((endMs - e.joinDate.getTime()) / 86_400_000)),
      });
      return s && empRows.length ? { employeeId: e.id, name: empRows[0].name, code: empRows[0].code, department: empRows[0].department, ...s } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const anomalies = detectAnomalies(rows, isNonWorking);

  return {
    attritionRisk: {
      window: { start: riskStart, end },
      scored: scored.length,
      counts: {
        high: scored.filter((s) => s.level === "high").length,
        medium: scored.filter((s) => s.level === "medium").length,
        low: scored.filter((s) => s.level === "low").length,
      },
      employees: scored,
    },
    anomalies: {
      period: { start: f.start, end: f.end },
      total: anomalies.length,
      employeesFlagged: new Set(anomalies.map((a) => a.employeeId)).size,
      flags: anomalies,
    },
  };
}

export type Insights = Awaited<ReturnType<typeof computeInsights>>;

/** Admin / HR only (REST via the dashboard, and the AI tool get_people_insights). */
export async function getPeopleInsights(actor: Session, opts: { start: string; end: string; department?: string; limit?: number }) {
  assertRole(actor, "ADMIN", "HR");
  const departmentId = await resolveDepartmentId(opts.department);
  const all = await computeInsights({ start: opts.start, end: opts.end, departmentId });
  const limit = Math.min(opts.limit ?? 10, 50);
  return {
    department: opts.department ?? "all departments",
    attritionRisk: { ...all.attritionRisk, employees: all.attritionRisk.employees.slice(0, limit) },
    anomalies: { ...all.anomalies, flags: all.anomalies.flags.slice(0, limit) },
    method:
      "Attrition risk is a rule-based score (0-100) from absenteeism, lateness, rising absence, unpaid leave and tenure over the last 90 days; high >= 60, medium >= 35. Anomalies are rule flags inside the period.",
  };
}
