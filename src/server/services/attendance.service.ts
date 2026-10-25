import type { AttendanceStatus, RequestStatus } from "@prisma/client";
import { z } from "zod";
import { audit, notify } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  eachDay,
  hhmmToMinutes,
  isIsoDate,
  localClock,
  maxIso,
  minIso,
  monthRange,
  toDate,
  toIso,
  todayIso,
  weekdayOf,
  workingDays,
  zonedDateTime,
} from "@/lib/dates";
import { badRequest, forbidden, HttpError } from "@/lib/errors";
import { haversineMeters, MAX_GPS_ACCURACY_M } from "@/lib/geo";
import { assertRole, scopeEmployeeId, type Session } from "@/lib/session";
import { getHolidays, getHolidaySet, getSettings, resolveDepartmentId, type Settings } from "./settings.service";

export type DayStatus = "present" | "late" | "half_day" | "missing_checkout" | "absent" | "on_leave" | "not_checked_in";

export interface DayRow {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  date: string;
  status: DayStatus;
}

/**
 * Status of one employee on one working day (Section 3, M4).
 * A stored LATE / HALF_DAY wins; a PRESENT record with no check-out on a past day is missing_checkout;
 * no record means on_leave (approved leave), not_checked_in (today, still open) or absent.
 */
export function classifyDay(
  day: string,
  today: string,
  record: { status: AttendanceStatus; checkOut: Date | null } | undefined,
  onApprovedLeave: boolean,
): DayStatus {
  if (record) {
    if (record.status === "HALF_DAY") return "half_day";
    if (record.status === "LATE") return "late";
    if (record.status === "MISSING_CHECKOUT") return "missing_checkout";
    if (!record.checkOut && day < today) return "missing_checkout";
    return "present";
  }
  if (onApprovedLeave) return "on_leave";
  if (day === today) return "not_checked_in";
  return "absent";
}

export interface Counts {
  present: number;
  late: number;
  half_day: number;
  missing_checkout: number;
  absent: number;
  on_leave: number;
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Section 7 formulas. Today's not-yet-checked-in rows are left out until the day closes. */
export function rates(c: Counts) {
  const records = c.present + c.late + c.half_day + c.missing_checkout + c.absent + c.on_leave;
  const expected = records - c.on_leave;
  return {
    workingDayRecords: records,
    attendanceRatePct: pct(c.present + c.late + c.missing_checkout + 0.5 * c.half_day, expected),
    latePct: pct(c.late, c.present + c.late),
    absenteeismPct: pct(c.absent, expected),
  };
}

export function emptyCounts(): Counts {
  return { present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0 };
}

interface RangeFilter {
  start: string;
  end: string;
  departmentId?: string;
  employeeId?: string | null;
}

/** One row per employee per working day in range (up to today). The base of every attendance number. */
export async function getDayRows(f: RangeFilter): Promise<DayRow[]> {
  if (f.start > f.end) throw badRequest("start must be on or before end");
  const today = todayIso();
  const last = minIso(f.end, today);
  if (f.start > last) return [];

  const [settings, holidays] = await Promise.all([getSettings(), getHolidaySet(f.start, last)]);
  const days = workingDays(f.start, last, settings.weekendDays, holidays);

  const employees = await db.employee.findMany({
    where: {
      status: { not: "INACTIVE" },
      joinDate: { lte: toDate(last) },
      OR: [{ exitDate: null }, { exitDate: { gte: toDate(f.start) } }],
      ...(f.departmentId && { departmentId: f.departmentId }),
      ...(f.employeeId && { id: f.employeeId }),
    },
    include: { department: true },
  });
  const ids = employees.map((e) => e.id);
  if (!ids.length || !days.length) return [];

  const [records, leaves] = await Promise.all([
    db.attendance.findMany({
      where: { employeeId: { in: ids }, date: { gte: toDate(f.start), lte: toDate(last) } },
      select: { employeeId: true, date: true, status: true, checkOut: true },
    }),
    db.leaveRequest.findMany({
      where: {
        employeeId: { in: ids },
        status: "APPROVED",
        startDate: { lte: toDate(last) },
        endDate: { gte: toDate(f.start) },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  const recordByKey = new Map(records.map((r) => [`${r.employeeId}|${toIso(r.date)}`, r]));
  const leavesByEmp = new Map<string, { start: string; end: string }[]>();
  for (const l of leaves) {
    const list = leavesByEmp.get(l.employeeId) ?? [];
    list.push({ start: toIso(l.startDate), end: toIso(l.endDate) });
    leavesByEmp.set(l.employeeId, list);
  }

  const rows: DayRow[] = [];
  for (const e of employees) {
    const from = maxIso(f.start, toIso(e.joinDate));
    const to = e.exitDate ? minIso(last, toIso(e.exitDate)) : last;
    const empLeaves = leavesByEmp.get(e.id) ?? [];
    for (const day of days) {
      if (day < from || day > to) continue;
      const onLeave = empLeaves.some((l) => l.start <= day && day <= l.end);
      rows.push({
        employeeId: e.id,
        name: e.fullName,
        code: e.code,
        department: e.department.name,
        date: day,
        status: classifyDay(day, today, recordByKey.get(`${e.id}|${day}`), onLeave),
      });
    }
  }
  return rows;
}

export function countRows(rows: DayRow[]): Counts {
  const c = emptyCounts();
  for (const r of rows) if (r.status !== "not_checked_in") c[r.status]++;
  return c;
}

export async function getAttendanceSummary(
  actor: Session,
  opts: { start: string; end: string; department?: string; employeeId?: string },
) {
  const employeeId = scopeEmployeeId(actor, opts.employeeId);
  // Employees may only see their own numbers, so a department filter makes no sense for them.
  const departmentId = actor.role === "EMPLOYEE" ? undefined : await resolveDepartmentId(opts.department);

  const rows = await getDayRows({ start: opts.start, end: opts.end, departmentId, employeeId });
  return summarizeRows(rows, {
    start: opts.start,
    end: opts.end,
    scope: employeeId ? (actor.role === "EMPLOYEE" ? "own" : "employee") : (opts.department ?? "all departments"),
    byDepartment: !employeeId,
  });
}

/** Pure: the attendance summary of already-loaded day rows (shared by the AI tool, REST and dashboard). */
export function summarizeRows(rows: DayRow[], o: { start: string; end: string; scope: string; byDepartment: boolean }) {
  const counts = countRows(rows);
  const byDept = new Map<string, DayRow[]>();
  if (o.byDepartment) {
    for (const r of rows) {
      const list = byDept.get(r.department);
      if (list) list.push(r);
      else byDept.set(r.department, [r]);
    }
  }
  return {
    period: { start: o.start, end: o.end },
    scope: o.scope,
    counts,
    ...rates(counts),
    byDepartment: [...byDept.entries()].map(([department, r]) => ({ department, ...rates(countRows(r)) })),
  };
}

export async function getLateComers(
  actor: Session,
  opts: { start: string; end: string; department?: string; limit?: number },
) {
  assertRole(actor, "ADMIN", "HR");
  const departmentId = await resolveDepartmentId(opts.department);
  const rows = await getDayRows({ start: opts.start, end: opts.end, departmentId });
  return lateComersFromRows(rows, opts);
}

/** Pure: employees ranked by late days in already-loaded day rows. */
export function lateComersFromRows(rows: DayRow[], opts: { start: string; end: string; limit?: number }) {
  const tally = new Map<string, { name: string; code: string; department: string; lateCount: number; lateDates: string[] }>();
  for (const r of rows) {
    if (r.status !== "late") continue;
    const t = tally.get(r.employeeId) ?? { name: r.name, code: r.code, department: r.department, lateCount: 0, lateDates: [] };
    t.lateCount++;
    t.lateDates.push(r.date);
    tally.set(r.employeeId, t);
  }
  return {
    period: { start: opts.start, end: opts.end },
    lateComers: [...tally.values()]
      .sort((a, b) => b.lateCount - a.lateCount || a.name.localeCompare(b.name))
      .slice(0, Math.min(opts.limit ?? 5, 20)),
  };
}

/** Today's board numbers for dashboards. Pass already-loaded rows that cover today to skip the query. */
export async function getTodaySnapshot(departmentId?: string, loaded?: DayRow[]) {
  const today = todayIso();
  const rows = (loaded ?? (await getDayRows({ start: today, end: today, departmentId }))).filter((r) => r.date === today);
  const c = countRows(rows);
  return {
    date: today,
    present: c.present + c.late + c.half_day + c.missing_checkout,
    late: c.late,
    onLeave: c.on_leave,
    notCheckedIn: rows.filter((r) => r.status === "not_checked_in").length,
  };
}

// ======================================================================
// M4 writes: check-in / check-out, calendar, daily board, corrections
// ======================================================================

function requireEmployee(actor: Session): string {
  if (!actor.employeeId) throw forbidden("Your login is not linked to an employee record.");
  return actor.employeeId;
}

/** LATE when the local check-in time is after office start + grace (e.g. after 09:15). */
export function statusForCheckIn(checkIn: Date, s: Pick<Settings, "officeStart" | "graceMinutes">): "PRESENT" | "LATE" {
  return localClock(checkIn).minutes > hhmmToMinutes(s.officeStart) + s.graceMinutes ? "LATE" : "PRESENT";
}

/** Final status of a day once check-out is known: under the half-day threshold wins over late. */
export function statusForDay(
  checkIn: Date,
  checkOut: Date | null,
  s: Pick<Settings, "officeStart" | "graceMinutes" | "halfDayHours">,
): AttendanceStatus {
  if (checkOut && (checkOut.getTime() - checkIn.getTime()) / 3_600_000 < s.halfDayHours) return "HALF_DAY";
  return statusForCheckIn(checkIn, s);
}

const recordOut = (r: {
  date: Date;
  checkIn: Date;
  checkOut: Date | null;
  status: AttendanceStatus;
  source: string;
  distanceMeters?: number | null;
}) => ({
  date: toIso(r.date),
  checkIn: r.checkIn.toISOString(),
  checkOut: r.checkOut?.toISOString() ?? null,
  status: r.status,
  source: r.source,
  distanceMeters: r.distanceMeters ?? null,
});

// ---------- Camera check-in (Section 5, bonus) ----------

/** What the browser sends after its own face + blink check. No photo ever leaves the device. */
// A body without `method` (the original web button sends {}) is a plain web check-in.
const defaultWeb = (v: unknown) => (v && typeof v === "object" && !("method" in v) ? { ...v, method: "web" } : v);

export const checkInSchema = z.preprocess(defaultWeb, z.discriminatedUnion("method", [
  z.object({ method: z.literal("web") }),
  z.object({
    method: z.literal("camera"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** GPS accuracy radius in metres, as reported by the Geolocation API */
    accuracy: z.number().min(0).max(1_000_000),
    /** faces the on-device detector saw in the frame that was accepted */
    faces: z.number().int().min(0).max(50),
    /** the user blinked in front of the camera (simple liveness check) */
    liveness: z.boolean(),
  }),
]));
export type CheckInInput = z.infer<typeof checkInSchema>;

const cameraRejected = (message: string) => new HttpError(422, `${message} You can ask HR for an attendance correction instead.`, "camera_rejected");

/**
 * The server's decision on a camera check-in: exactly one face, a blink, a GPS fix of 100 m or better,
 * and a Haversine distance to the office within the radius Admin set. Throws 422 with the reason otherwise.
 */
export function evaluateCameraCheckIn(
  input: Extract<CheckInInput, { method: "camera" }>,
  s: Pick<Settings, "officeLat" | "officeLng" | "radiusMeters">,
): { distanceMeters: number; gpsAccuracy: number } {
  if (s.officeLat == null || s.officeLng == null) {
    throw new HttpError(409, "Camera check-in is not set up yet: Admin has not saved the office location.", "not_configured");
  }
  if (input.faces === 0) throw cameraRejected("No face was found in the camera.");
  if (input.faces > 1) throw cameraRejected("More than one face was found. Only you should be in the frame.");
  if (!input.liveness) throw cameraRejected("The blink check was not passed.");
  const gpsAccuracy = Math.round(input.accuracy);
  if (input.accuracy > MAX_GPS_ACCURACY_M) {
    throw cameraRejected(`Your location is too imprecise (±${gpsAccuracy} m; ${MAX_GPS_ACCURACY_M} m or better is needed). Try near a window or turn on precise location.`);
  }
  const distanceMeters = Math.round(haversineMeters({ lat: input.lat, lng: input.lng }, { lat: s.officeLat, lng: s.officeLng }));
  if (distanceMeters > s.radiusMeters) {
    throw cameraRejected(`You are ${distanceMeters} m from the office; check-in is allowed within ${s.radiusMeters} m.`);
  }
  return { distanceMeters, gpsAccuracy };
}

/** Server stamps the time; one record per employee per day (a second check-in is a 409). */
export async function checkIn(actor: Session, now: Date = new Date(), input: CheckInInput = { method: "web" }) {
  const employeeId = requireEmployee(actor);
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { status: true } });
  if (!emp || emp.status === "INACTIVE" || emp.status === "EXITED") throw forbidden("Your employee record is not active.");

  const date = toDate(todayIso(now));
  const existing = await db.attendance.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (existing) throw new HttpError(409, "You have already checked in today.", "conflict");

  const settings = await getSettings();
  if (input.method === "web" && settings.cameraRequired) {
    throw new HttpError(403, "Your company requires camera check-in (face + location). Use the camera check-in button.", "camera_required");
  }
  const camera = input.method === "camera" ? evaluateCameraCheckIn(input, settings) : null;

  const status = statusForCheckIn(now, settings);
  try {
    return recordOut(
      await db.attendance.create({
        data: { employeeId, date, checkIn: now, status, source: input.method, ...(camera ?? {}) },
      }),
    );
  } catch (err) {
    // Two clicks at once: the unique (employee, date) index decides.
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "You have already checked in today.", "conflict");
    throw err;
  }
}

export async function checkOut(actor: Session, now: Date = new Date()) {
  const employeeId = requireEmployee(actor);
  const rec = await db.attendance.findUnique({ where: { employeeId_date: { employeeId, date: toDate(todayIso(now)) } } });
  if (!rec) throw badRequest("You have not checked in today.");
  if (rec.checkOut) throw new HttpError(409, "You have already checked out today.", "conflict");

  const settings = await getSettings();
  const workedHours = (now.getTime() - rec.checkIn.getTime()) / 3_600_000;
  const status: AttendanceStatus = workedHours < settings.halfDayHours ? "HALF_DAY" : rec.status;
  // Conditional: two check-out clicks at once must not both stamp a time.
  const { count } = await db.attendance.updateMany({ where: { id: rec.id, checkOut: null }, data: { checkOut: now, status } });
  if (!count) throw new HttpError(409, "You have already checked out today.", "conflict");
  return recordOut(await db.attendance.findUniqueOrThrow({ where: { id: rec.id } }));
}

export async function getToday(actor: Session, now: Date = new Date()) {
  const employeeId = requireEmployee(actor);
  const today = todayIso(now);
  const [settings, holidays, rec] = await Promise.all([
    getSettings(),
    getHolidaySet(today, today),
    db.attendance.findUnique({ where: { employeeId_date: { employeeId, date: toDate(today) } } }),
  ]);
  return {
    date: today,
    isWorkingDay: !settings.weekendDays.includes(weekdayOf(today)) && !holidays.has(today),
    officeStart: settings.officeStart,
    graceMinutes: settings.graceMinutes,
    halfDayHours: settings.halfDayHours,
    camera: {
      available: settings.officeLat != null && settings.officeLng != null,
      required: settings.cameraRequired,
      radiusMeters: settings.radiusMeters,
      maxAccuracyMeters: MAX_GPS_ACCURACY_M,
    },
    record: rec ? recordOut(rec) : null,
  };
}

export type CalendarKind = DayStatus | "weekend" | "holiday" | "future" | "not_employed";

/** One month for one employee: every calendar day with its status and times. */
export async function getCalendar(actor: Session, opts: { month: string; employeeId?: string }, now: Date = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month)) throw badRequest("month must be YYYY-MM");
  const employeeId = scopeEmployeeId(actor, opts.employeeId) ?? actor.employeeId;
  if (!employeeId) throw badRequest("Choose an employee.");
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, code: true } });
  if (!emp) throw new HttpError(404, "Employee not found", "not_found");

  const { start, end } = monthRange(opts.month);
  const today = todayIso(now);
  const [settings, holidays, rows, records] = await Promise.all([
    getSettings(),
    getHolidays(start, end),
    getDayRows({ start, end, employeeId }),
    db.attendance.findMany({ where: { employeeId, date: { gte: toDate(start), lte: toDate(end) } } }),
  ]);
  const holidayName = new Map(holidays.map((h) => [h.date, h.name]));
  const statusByDay = new Map(rows.map((r) => [r.date, r.status]));
  const recByDay = new Map(records.map((r) => [toIso(r.date), r]));

  const days = eachDay(start, end).map((date) => {
    const rec = recByDay.get(date);
    let kind: CalendarKind;
    if (settings.weekendDays.includes(weekdayOf(date))) kind = "weekend";
    else if (holidayName.has(date)) kind = "holiday";
    else if (date > today) kind = "future";
    else kind = statusByDay.get(date) ?? "not_employed";
    return {
      date,
      kind,
      holiday: holidayName.get(date) ?? null,
      checkIn: rec?.checkIn.toISOString() ?? null,
      checkOut: rec?.checkOut?.toISOString() ?? null,
    };
  });
  const counts = countRows(rows);
  return { month: opts.month, employee: emp, days, counts, ...rates(counts) };
}

/** Daily attendance board (Admin / HR): every employee's status and times for one date. */
export async function getBoard(actor: Session, opts: { date: string; department?: string }) {
  assertRole(actor, "ADMIN", "HR");
  if (!isIsoDate(opts.date)) throw badRequest("date must be YYYY-MM-DD");
  const departmentId = await resolveDepartmentId(opts.department);
  const [settings, holidays, rows, records] = await Promise.all([
    getSettings(),
    getHolidays(opts.date, opts.date),
    getDayRows({ start: opts.date, end: opts.date, departmentId }),
    db.attendance.findMany({
      where: { date: toDate(opts.date), ...(departmentId && { employee: { departmentId } }) },
      include: { employee: { include: { department: true } } },
    }),
  ]);
  const recByEmp = new Map(records.map((r) => [r.employeeId, r]));

  const out = rows.map((r) => {
    const rec = recByEmp.get(r.employeeId);
    return {
      employeeId: r.employeeId,
      name: r.name,
      code: r.code,
      department: r.department,
      status: r.status as string,
      checkIn: rec?.checkIn.toISOString() ?? null,
      checkOut: rec?.checkOut?.toISOString() ?? null,
      source: rec?.source ?? null,
      distanceMeters: rec?.distanceMeters ?? null,
    };
  });
  // People who worked on a weekend or holiday still show up on the board.
  for (const rec of records) {
    if (out.some((o) => o.employeeId === rec.employeeId)) continue;
    out.push({
      employeeId: rec.employeeId,
      name: rec.employee.fullName,
      code: rec.employee.code,
      department: rec.employee.department.name,
      status: rec.status.toLowerCase(),
      checkIn: rec.checkIn.toISOString(),
      checkOut: rec.checkOut?.toISOString() ?? null,
      source: rec.source,
      distanceMeters: rec.distanceMeters,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return {
    date: opts.date,
    isWorkingDay: !settings.weekendDays.includes(weekdayOf(opts.date)) && holidays.length === 0,
    holiday: holidays[0]?.name ?? null,
    summary: { ...countRows(rows), notCheckedIn: rows.filter((r) => r.status === "not_checked_in").length },
    rows: out,
  };
}

// ---------- Corrections (#11): employee requests, HR approves ----------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const correctionSchema = z.object({
  date: z.string().refine(isIsoDate, "Use YYYY-MM-DD"),
  checkIn: hhmm,
  checkOut: hhmm.nullable().optional(),
  reason: z.string().trim().min(3, "Please give a reason").max(300),
});

export const correctionDecisionSchema = z
  .object({ approve: z.boolean(), comment: z.string().trim().max(300).optional() })
  .refine((d) => d.approve || !!d.comment, { message: "A comment is required when rejecting", path: ["comment"] });

type CorrectionRow = {
  id: string;
  employeeId: string;
  date: Date;
  requestedCheckIn: Date;
  requestedCheckOut: Date | null;
  reason: string;
  status: RequestStatus;
  decisionComment: string | null;
  createdAt: Date;
  employee?: { fullName: string; code: string; department: { name: string } } | null;
};

function correctionOut(c: CorrectionRow) {
  return {
    id: c.id,
    employeeId: c.employeeId,
    employee: c.employee ? { name: c.employee.fullName, code: c.employee.code, department: c.employee.department.name } : null,
    date: toIso(c.date),
    checkIn: c.requestedCheckIn.toISOString(),
    checkOut: c.requestedCheckOut?.toISOString() ?? null,
    reason: c.reason,
    status: c.status,
    comment: c.decisionComment,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function requestCorrection(actor: Session, input: z.infer<typeof correctionSchema>, now: Date = new Date()) {
  const employeeId = requireEmployee(actor);
  if (input.date > todayIso(now)) throw badRequest("You can only correct today or past days.");
  if (input.checkOut && hhmmToMinutes(input.checkOut) <= hhmmToMinutes(input.checkIn)) throw badRequest("Check-out must be after check-in.");
  const dup = await db.attendanceCorrection.findFirst({ where: { employeeId, date: toDate(input.date), status: "PENDING" } });
  if (dup) throw new HttpError(409, "You already have a pending correction for this day.", "conflict");

  return db.$transaction(async (tx) => {
    const c = await tx.attendanceCorrection.create({
      data: {
        employeeId,
        date: toDate(input.date),
        requestedCheckIn: zonedDateTime(input.date, input.checkIn),
        requestedCheckOut: input.checkOut ? zonedDateTime(input.date, input.checkOut) : null,
        reason: input.reason,
      },
    });
    await audit(actor, "create", "attendance_correction", c.id, { after: input }, tx);
    const hrUsers = await tx.user.findMany({ where: { role: "HR", isActive: true }, select: { id: true } });
    await notify(
      hrUsers.map((u) => u.id).filter((id) => id !== actor.userId),
      { title: "Attendance correction requested", body: `${actor.name ?? "An employee"} asked to correct ${input.date}.`, link: "/attendance" },
      tx,
    );
    return correctionOut(c);
  });
}

export async function listCorrections(actor: Session, opts: { status?: string } = {}) {
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(opts.status ?? "") ? (opts.status as RequestStatus) : undefined;
  const own = actor.role === "EMPLOYEE" ? requireEmployee(actor) : undefined;
  const rows = await db.attendanceCorrection.findMany({
    where: { ...(own && { employeeId: own }), ...(status && { status }) },
    include: { employee: { include: { department: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return { items: rows.map(correctionOut) };
}

/** HR approves (the attendance row is created or replaced) or rejects with a comment. Admin can only view. */
export async function decideCorrection(actor: Session, id: string, input: { approve: boolean; comment?: string }) {
  assertRole(actor, "HR");
  if (!input.approve && !input.comment) throw badRequest("A comment is required when rejecting.");
  const c = await db.attendanceCorrection.findUnique({ where: { id }, include: { employee: { include: { department: true } } } });
  if (!c) throw new HttpError(404, "Correction not found", "not_found");
  if (c.status !== "PENDING") throw new HttpError(409, `This request was already ${c.status.toLowerCase()}.`, "conflict");
  if (c.employeeId === actor.employeeId) throw forbidden("You cannot decide your own request.");

  const settings = await getSettings();
  return db.$transaction(async (tx) => {
    // Claim the request first (conditional on PENDING) so two concurrent decisions cannot both apply.
    const claimed = await tx.attendanceCorrection.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decisionComment: input.comment || null },
    });
    if (!claimed.count) throw new HttpError(409, "This request was already decided.", "conflict");
    let attendance = null;
    if (input.approve) {
      const key = { employeeId_date: { employeeId: c.employeeId, date: c.date } };
      const before = await tx.attendance.findUnique({ where: key });
      const data = {
        checkIn: c.requestedCheckIn,
        checkOut: c.requestedCheckOut,
        status: statusForDay(c.requestedCheckIn, c.requestedCheckOut, settings),
        source: "correction",
      };
      attendance = await tx.attendance.upsert({ where: key, create: { employeeId: c.employeeId, date: c.date, ...data }, update: data });
      await audit(actor, "update", "attendance", attendance.id, { before, after: attendance }, tx);
    }
    const updated = await tx.attendanceCorrection.findUniqueOrThrow({ where: { id }, include: { employee: { include: { department: true } } } });
    await audit(
      actor,
      input.approve ? "approve" : "reject",
      "attendance_correction",
      id,
      { before: { status: c.status }, after: { status: updated.status, comment: input.comment ?? null } },
      tx,
    );
    await notify(
      [c.employee.userId],
      {
        title: `Attendance correction ${input.approve ? "approved" : "rejected"}`,
        body: `${toIso(c.date)}${input.comment ? `: ${input.comment}` : ""}`,
        link: "/attendance",
      },
      tx,
    );
    return { correction: correctionOut(updated), attendance: attendance ? recordOut(attendance) : null };
  });
}
