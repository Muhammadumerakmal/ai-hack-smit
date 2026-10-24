import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isIsoDate, toDate, toIso } from "@/lib/dates";
import { badRequest, HttpError } from "@/lib/errors";
import { assertRole, type Session } from "@/lib/session";
import { getSettings } from "./settings.service";

// M2: Admin manages; HR can view (checklist #03, #04).

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const settingsSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  officeStart: hhmm,
  graceMinutes: z.number().int().min(0).max(180),
  halfDayHours: z.number().min(1).max(12),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(6),
  officeLat: z.number().min(-90).max(90).nullable(),
  officeLng: z.number().min(-180).max(180).nullable(),
  radiusMeters: z.number().int().min(20).max(5000),
});

export async function getCompanySettings(actor: Session) {
  assertRole(actor, "ADMIN", "HR");
  const row = await db.companySettings.findUnique({ where: { id: 1 } });
  return { ...(await getSettings()), officeLat: row?.officeLat ?? null, officeLng: row?.officeLng ?? null };
}

/** Applied to new records only: stored attendance statuses are never recalculated. */
export async function updateCompanySettings(actor: Session, input: z.infer<typeof settingsSchema>) {
  assertRole(actor, "ADMIN");
  const before = await db.companySettings.findUnique({ where: { id: 1 } });
  const data = { ...input, weekendDays: [...new Set(input.weekendDays)].sort() };
  return db.$transaction(async (tx) => {
    const after = await tx.companySettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(actor, "update", "settings", "1", { before, after }, tx);
    return after;
  });
}

// ---------- Departments & designations ----------

const nameSchema = z.object({ name: z.string().trim().min(2).max(80) });
export { nameSchema };

export async function listDepartments() {
  const rows = await db.department.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { name: "asc" } });
  return rows.map((d) => ({ id: d.id, name: d.name, employees: d._count.employees }));
}

export async function createDepartment(actor: Session, name: string) {
  assertRole(actor, "ADMIN");
  return db.$transaction(async (tx) => {
    const d = await tx.department.create({ data: { name } });
    await audit(actor, "create", "department", d.id, { after: d }, tx);
    return d;
  });
}

export async function renameDepartment(actor: Session, id: string, name: string) {
  assertRole(actor, "ADMIN");
  return db.$transaction(async (tx) => {
    const before = await tx.department.findUniqueOrThrow({ where: { id } });
    const d = await tx.department.update({ where: { id }, data: { name } });
    await audit(actor, "update", "department", id, { before, after: d }, tx);
    return d;
  });
}

export async function deleteDepartment(actor: Session, id: string) {
  assertRole(actor, "ADMIN");
  if (await db.employee.count({ where: { departmentId: id } })) throw badRequest("This department still has employees.");
  await db.$transaction(async (tx) => {
    const before = await tx.department.delete({ where: { id } });
    await audit(actor, "delete", "department", id, { before }, tx);
  });
}

export async function listDesignations() {
  const rows = await db.designation.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { title: "asc" } });
  return rows.map((d) => ({ id: d.id, name: d.title, employees: d._count.employees }));
}

export async function createDesignation(actor: Session, title: string) {
  assertRole(actor, "ADMIN");
  return db.$transaction(async (tx) => {
    const d = await tx.designation.create({ data: { title } });
    await audit(actor, "create", "designation", d.id, { after: d }, tx);
    return { id: d.id, name: d.title };
  });
}

export async function renameDesignation(actor: Session, id: string, title: string) {
  assertRole(actor, "ADMIN");
  return db.$transaction(async (tx) => {
    const before = await tx.designation.findUniqueOrThrow({ where: { id } });
    const d = await tx.designation.update({ where: { id }, data: { title } });
    await audit(actor, "update", "designation", id, { before, after: d }, tx);
    return { id: d.id, name: d.title };
  });
}

export async function deleteDesignation(actor: Session, id: string) {
  assertRole(actor, "ADMIN");
  if (await db.employee.count({ where: { designationId: id } })) throw badRequest("This designation is still in use.");
  await db.$transaction(async (tx) => {
    const before = await tx.designation.delete({ where: { id } });
    await audit(actor, "delete", "designation", id, { before }, tx);
  });
}

// ---------- Leave types ----------

export const leaveTypeSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,19}$/, "Use a short lowercase code, e.g. casual"),
  name: z.string().trim().min(2).max(40),
  yearlyQuota: z.number().int().min(0).max(365).nullable(),
  isPaid: z.boolean(),
});

export async function listLeaveTypes() {
  return db.leaveType.findMany({ orderBy: { code: "asc" } });
}

export async function upsertLeaveType(actor: Session, input: z.infer<typeof leaveTypeSchema>, id?: string) {
  assertRole(actor, "ADMIN");
  return db.$transaction(async (tx) => {
    const before = id ? await tx.leaveType.findUniqueOrThrow({ where: { id } }) : null;
    const after = id ? await tx.leaveType.update({ where: { id }, data: input }) : await tx.leaveType.create({ data: input });
    await audit(actor, id ? "update" : "create", "leave_type", after.id, { before, after }, tx);
    return after;
  });
}

// ---------- Holidays ----------

export const holidaySchema = z.object({
  date: z.string().refine(isIsoDate, "Use YYYY-MM-DD"),
  name: z.string().trim().min(2).max(80),
});

export async function listHolidays(year: number) {
  const rows = await db.holiday.findMany({
    where: { date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } },
    orderBy: { date: "asc" },
  });
  return rows.map((h) => ({ id: h.id, date: toIso(h.date), name: h.name }));
}

export async function createHoliday(actor: Session, input: z.infer<typeof holidaySchema>) {
  assertRole(actor, "ADMIN");
  return db.$transaction(async (tx) => {
    const h = await tx.holiday.create({ data: { date: toDate(input.date), name: input.name } });
    await audit(actor, "create", "holiday", h.id, { after: input }, tx);
    return { id: h.id, ...input };
  });
}

export async function deleteHoliday(actor: Session, id: string) {
  assertRole(actor, "ADMIN");
  await db.$transaction(async (tx) => {
    const before = await tx.holiday.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "Holiday not found", "not_found");
    await tx.holiday.delete({ where: { id } });
    await audit(actor, "delete", "holiday", id, { before: { date: toIso(before.date), name: before.name } }, tx);
  });
}
