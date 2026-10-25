import { db } from "@/lib/db";
import { toDate, toIso } from "@/lib/dates";
import { HttpError } from "@/lib/errors";

export interface Settings {
  companyName: string;
  officeStart: string;
  graceMinutes: number;
  halfDayHours: number;
  weekendDays: number[];
  officeLat: number | null;
  officeLng: number | null;
  radiusMeters: number;
  latePenaltyEnabled: boolean;
  cameraRequired: boolean;
}

// Section 3 defaults, used until Admin saves company settings.
export const DEFAULT_SETTINGS: Settings = {
  companyName: "the company",
  officeStart: "09:00",
  graceMinutes: 15,
  halfDayHours: 5,
  weekendDays: [0, 6],
  officeLat: null,
  officeLng: null,
  radiusMeters: 150,
  latePenaltyEnabled: false,
  cameraRequired: false,
};

export async function getSettings(): Promise<Settings> {
  const row = await db.companySettings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_SETTINGS;
  return {
    companyName: row.companyName,
    officeStart: row.officeStart,
    graceMinutes: row.graceMinutes,
    halfDayHours: row.halfDayHours,
    weekendDays: row.weekendDays,
    officeLat: row.officeLat,
    officeLng: row.officeLng,
    radiusMeters: row.radiusMeters,
    latePenaltyEnabled: row.latePenaltyEnabled,
    cameraRequired: row.cameraRequired,
  };
}

export async function getHolidays(start: string, end: string): Promise<{ date: string; name: string }[]> {
  const rows = await db.holiday.findMany({
    where: { date: { gte: toDate(start), lte: toDate(end) } },
    orderBy: { date: "asc" },
  });
  return rows.map((h) => ({ date: toIso(h.date), name: h.name }));
}

export async function getHolidaySet(start: string, end: string): Promise<Set<string>> {
  return new Set((await getHolidays(start, end)).map((h) => h.date));
}

export async function getLeaveTypes() {
  return db.leaveType.findMany({ orderBy: { code: "asc" } });
}

/** Department filter by name (what people type) → id. Unknown names are a 404 listing the real ones. */
export async function resolveDepartmentId(name?: string | null): Promise<string | undefined> {
  if (!name) return undefined;
  const dept = await db.department.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" } } });
  if (dept) return dept.id;
  const all = await db.department.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  throw new HttpError(
    404,
    `No department named "${name}". Known departments: ${all.map((d) => d.name).join(", ") || "none yet"}.`,
    "not_found",
  );
}
