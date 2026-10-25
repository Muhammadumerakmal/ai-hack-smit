import type { LeaveStatus, LeaveType, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { audit, notify } from "@/lib/audit";
import { db } from "@/lib/db";
import { addDays, maxIso, minIso, toDate, toIso, todayIso, workingDays, yearRange } from "@/lib/dates";
import { badRequest, forbidden, HttpError } from "@/lib/errors";
import { assertRole, scopeEmployeeId, type Session } from "@/lib/session";
import { getHolidaySet, getLeaveTypes, getSettings, resolveDepartmentId } from "./settings.service";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Working days of each leave type an employee has APPROVED / PENDING inside one calendar year.
 *
 * Year attribution: a leave that crosses New Year (e.g. 30 Dec – 2 Jan) is split by calendar year —
 * each year's quota is charged only for the working days that fall in that year. Leaves fully inside
 * the year use the `days` stored when they were applied for; a crossing leave's share is recomputed
 * with the current weekend and holiday settings.
 */
export async function usedDaysInYear(client: Client, employeeId: string, year: number) {
  const { start, end } = yearRange(year);
  const rows = await client.leaveRequest.findMany({
    where: { employeeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: toDate(end) }, endDate: { gte: toDate(start) } },
    select: { leaveTypeId: true, status: true, days: true, startDate: true, endDate: true },
  });
  const crossing = rows.filter((r) => toIso(r.startDate) < start || toIso(r.endDate) > end);
  const [settings, holidays] = crossing.length ? await Promise.all([getSettings(), getHolidaySet(start, end)]) : [null, null];

  const used = new Map<string, { APPROVED: number; PENDING: number }>();
  for (const r of rows) {
    const s = toIso(r.startDate);
    const e = toIso(r.endDate);
    const days = s >= start && e <= end ? r.days : workingDays(maxIso(s, start), minIso(e, end), settings!.weekendDays, holidays!).length;
    const u = used.get(r.leaveTypeId) ?? { APPROVED: 0, PENDING: 0 };
    u[r.status as "APPROVED" | "PENDING"] += days;
    used.set(r.leaveTypeId, u);
  }
  return used;
}

/** Group a request's working days by calendar year: { 2026: 2, 2027: 1 }. */
function daysPerYear(dates: string[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of dates) m.set(Number(d.slice(0, 4)), (m.get(Number(d.slice(0, 4))) ?? 0) + 1);
  return m;
}

/** Balance problems for taking `dates` of `type` (quota checked per calendar year). Empty = fine. */
async function balanceProblems(client: Client, employeeId: string, type: LeaveType, dates: string[]) {
  const problems: string[] = [];
  const remainingAfter = new Map<number, number>();
  if (type.yearlyQuota == null) return { problems, remainingAfter };
  for (const [year, n] of daysPerYear(dates)) {
    const used = (await usedDaysInYear(client, employeeId, year)).get(type.id)?.APPROVED ?? 0;
    const remaining = type.yearlyQuota - used;
    remainingAfter.set(year, remaining - n);
    if (remaining < n) problems.push(`Not enough ${type.name} balance${dates.length > n ? ` for ${year}` : ""}: ${remaining} left, ${n} requested.`);
  }
  return { problems, remainingAfter };
}

/** Serialise leave writes per employee (apply / approve), so two requests cannot both pass the checks. */
async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
}

/** Leave balance for one employee and year: quota − approved days. Pending is shown but not deducted. */
export async function getLeaveBalance(actor: Session, opts: { employeeId?: string; year?: number } = {}) {
  const employeeId = scopeEmployeeId(actor, opts.employeeId) ?? actor.employeeId;
  if (!employeeId) throw badRequest("Your login is not linked to an employee record, so there is no leave balance.");
  const year = opts.year ?? Number(todayIso().slice(0, 4));

  const [types, used] = await Promise.all([getLeaveTypes(), usedDaysInYear(db, employeeId, year)]);
  const sum = (typeId: string, status: "APPROVED" | "PENDING") => used.get(typeId)?.[status] ?? 0;

  return {
    year,
    balances: types.map((t) => {
      const approved = sum(t.id, "APPROVED");
      return {
        type: t.code,
        name: t.name,
        quota: t.yearlyQuota, // null = unlimited
        usedApproved: approved,
        pending: sum(t.id, "PENDING"),
        remaining: t.yearlyQuota == null ? null : t.yearlyQuota - approved,
      };
    }),
  };
}

export async function getLeaveSummary(
  actor: Session,
  opts: { start: string; end: string; department?: string; employeeId?: string },
) {
  const employeeId = scopeEmployeeId(actor, opts.employeeId);
  const departmentId = actor.role === "EMPLOYEE" ? undefined : await resolveDepartmentId(opts.department);
  if (opts.start > opts.end) throw badRequest("start must be on or before end");

  const empFilter = {
    ...(employeeId && { employeeId }),
    ...(departmentId && { employee: { departmentId } }),
  };
  const today = todayIso();

  const [settings, holidays, types, approved, pendingCount, onLeaveToday, headcount, upcoming] = await Promise.all([
    getSettings(),
    getHolidaySet(opts.start, opts.end),
    getLeaveTypes(),
    db.leaveRequest.findMany({
      where: { ...empFilter, status: "APPROVED", startDate: { lte: toDate(opts.end) }, endDate: { gte: toDate(opts.start) } },
      include: { employee: { include: { department: true } }, leaveType: true },
    }),
    db.leaveRequest.count({ where: { ...empFilter, status: "PENDING" } }),
    db.leaveRequest.findMany({
      where: { ...empFilter, status: "APPROVED", startDate: { lte: toDate(today) }, endDate: { gte: toDate(today) } },
      include: { employee: { include: { department: true } }, leaveType: true },
    }),
    db.employee.count({ where: { status: { in: ["ACTIVE", "PROBATION"] }, ...(departmentId && { departmentId }), ...(employeeId && { id: employeeId }) } }),
    db.leaveRequest.findMany({
      where: { ...empFilter, status: "APPROVED", startDate: { gt: toDate(today), lte: toDate(addDays(today, 14)) } },
      include: { employee: { include: { department: true } }, leaveType: true },
      orderBy: { startDate: "asc" },
      take: 20,
    }),
  ]);

  // Only the part of each leave that falls inside the period, in working days.
  const byType = new Map<string, number>();
  const byDept = new Map<string, number>();
  for (const l of approved) {
    const days = workingDays(maxIso(opts.start, toIso(l.startDate)), minIso(opts.end, toIso(l.endDate)), settings.weekendDays, holidays).length;
    byType.set(l.leaveType.code, (byType.get(l.leaveType.code) ?? 0) + days);
    byDept.set(l.employee.department.name, (byDept.get(l.employee.department.name) ?? 0) + days);
  }

  return {
    period: { start: opts.start, end: opts.end },
    scope: employeeId ? "own" : (opts.department ?? "all departments"),
    approvedDaysByType: types.map((t) => {
      const days = byType.get(t.code) ?? 0;
      const pool = t.yearlyQuota ? t.yearlyQuota * headcount : null;
      return { type: t.code, days, utilizationPct: pool ? Math.round((days / pool) * 1000) / 10 : null };
    }),
    approvedDaysByDepartment: [...byDept.entries()].map(([department, days]) => ({ department, days })),
    // Who is away during the period (future periods too, e.g. "who is on leave next week"), first start first.
    onLeaveInPeriod: approved
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .slice(0, 50)
      .map((l) => ({
        name: l.employee.fullName,
        department: l.employee.department.name,
        type: l.leaveType.code,
        start: toIso(l.startDate),
        end: toIso(l.endDate),
        workingDaysInPeriod: workingDays(maxIso(opts.start, toIso(l.startDate)), minIso(opts.end, toIso(l.endDate)), settings.weekendDays, holidays).length,
      })),
    pendingRequests: pendingCount,
    onLeaveToday: {
      date: today,
      count: onLeaveToday.length,
      employees: onLeaveToday.map((l) => ({
        name: l.employee.fullName,
        department: l.employee.department.name,
        type: l.leaveType.code,
        until: toIso(l.endDate),
      })),
    },
    upcomingNext14Days: upcoming.map((l) => ({
      name: l.employee.fullName,
      department: l.employee.department.name,
      type: l.leaveType.code,
      start: toIso(l.startDate),
      end: toIso(l.endDate),
    })),
  };
}

export interface LeaveDraft {
  type: string;
  start: string;
  end: string;
  reason: string;
}

/**
 * Dry-run of the M5 rules for a draft request, without saving anything:
 * working days (weekends and holidays skipped), overlap and balance.
 * M5's apply route should call this too and turn `blocking` problems into a 422.
 */
export async function previewLeave(actor: Session, draft: LeaveDraft) {
  if (actor.role === "ADMIN" || !actor.employeeId) throw forbidden("Only employees can apply for leave");
  if (draft.start > draft.end) throw badRequest("start must be on or before end");

  const type = (await getLeaveTypes()).find((t) => t.code === draft.type);
  if (!type) throw badRequest(`Unknown leave type "${draft.type}"`);

  const [settings, holidays] = await Promise.all([getSettings(), getHolidaySet(draft.start, draft.end)]);
  const days = workingDays(draft.start, draft.end, settings.weekendDays, holidays);

  const blocking: string[] = [];
  const notes: string[] = [];
  if (draft.start < todayIso()) blocking.push("The start date is in the past.");
  if (days.length === 0) blocking.push("These dates have no working days (weekend or holiday).");

  const skipped = holidays.size ? [...holidays].filter((h) => h >= draft.start && h <= draft.end) : [];
  if (skipped.length) notes.push(`Public holiday(s) skipped: ${skipped.join(", ")}.`);

  const overlapMsg = await overlapProblem(db, actor.employeeId, draft.start, draft.end);
  if (overlapMsg) blocking.push(overlapMsg);

  let remainingAfter: number | null = null;
  if (type.yearlyQuota != null && days.length) {
    const balance = await balanceProblems(db, actor.employeeId, type, days);
    blocking.push(...balance.problems);
    remainingAfter = balance.remainingAfter.get(Number(days[0].slice(0, 4))) ?? null;
    const years = [...daysPerYear(days).entries()];
    if (years.length > 1) notes.push(`This leave crosses New Year: ${years.map(([y, n]) => `${n} day(s) count against ${y}`).join(", ")}.`);
  }

  return { workingDays: days.length, dates: days, remainingAfter, blocking, notes };
}

/** "You already have …" when an active (pending/approved) leave touches [start, end]; dates are inclusive. */
async function overlapProblem(client: Client, employeeId: string, start: string, end: string, excludeId?: string) {
  const overlap = await client.leaveRequest.findFirst({
    where: {
      ...(excludeId && { id: { not: excludeId } }),
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: toDate(end) },
      endDate: { gte: toDate(start) },
    },
  });
  return overlap ? `You already have ${overlap.status === "APPROVED" ? "an approved" : "a pending"} leave from ${toIso(overlap.startDate)} to ${toIso(overlap.endDate)}.` : null;
}

/**
 * Employee applies for leave (the "confirm" step of smart leave and the normal form).
 * Same rules as previewLeave; any blocking problem is a 422 (Section 3, M5). Saved as PENDING for HR.
 * Overlap and balance are re-checked under a per-employee row lock, so a double-click or two tabs
 * cannot create two overlapping requests.
 */
export async function applyForLeave(actor: Session, draft: LeaveDraft) {
  const preview = await previewLeave(actor, draft);
  if (preview.blocking.length) throw new HttpError(422, preview.blocking.join(" "), "unprocessable");

  const type = (await getLeaveTypes()).find((t) => t.code === draft.type)!;
  const request = await db.$transaction(async (tx) => {
    await lockEmployee(tx, actor.employeeId!);
    const again = [await overlapProblem(tx, actor.employeeId!, draft.start, draft.end), ...(await balanceProblems(tx, actor.employeeId!, type, preview.dates)).problems];
    const problems = again.filter((p): p is string => !!p);
    if (problems.length) throw new HttpError(422, problems.join(" "), "unprocessable");
    const r = await tx.leaveRequest.create({
      data: {
        employeeId: actor.employeeId!,
        leaveTypeId: type.id,
        startDate: toDate(draft.start),
        endDate: toDate(draft.end),
        days: preview.workingDays,
        reason: draft.reason,
      },
    });
    await audit(actor, "create", "leave_request", r.id, { after: { ...draft, days: r.days } }, tx);
    const hrUsers = await tx.user.findMany({ where: { role: "HR", isActive: true }, select: { id: true } });
    await notify(
      hrUsers.map((u) => u.id).filter((uid) => uid !== actor.userId),
      { title: "New leave request", body: `${actor.name ?? "An employee"}: ${type.name}, ${draft.start} to ${draft.end} (${r.days} days).`, link: "/leave" },
      tx,
    );
    return r;
  });
  return { id: request.id, status: request.status, days: request.days, type: type.code, start: draft.start, end: draft.end };
}

// ---------- M5: list, cancel, approve / reject ----------

export const leaveDecisionSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().trim().max(300).optional() })
  .refine((d) => d.decision === "APPROVED" || !!d.comment, { message: "A comment is required when rejecting", path: ["comment"] });

/** Employees see their own requests; HR and Admin see everyone's (optionally only their own with mine=true). */
export async function listLeaveRequests(actor: Session, opts: { status?: string; mine?: boolean } = {}) {
  const ownOnly = actor.role === "EMPLOYEE" || opts.mine;
  if (ownOnly && !actor.employeeId) return { items: [] };
  const status = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(opts.status ?? "") ? (opts.status as LeaveStatus) : undefined;
  const today = todayIso();

  const rows = await db.leaveRequest.findMany({
    where: { ...(ownOnly && { employeeId: actor.employeeId! }), ...(status && { status }) },
    include: { employee: { include: { department: true } }, leaveType: true },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return {
    items: rows.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      employee: { name: l.employee.fullName, code: l.employee.code, department: l.employee.department.name },
      type: l.leaveType.code,
      typeName: l.leaveType.name,
      start: toIso(l.startDate),
      end: toIso(l.endDate),
      days: l.days,
      reason: l.reason,
      status: l.status,
      comment: l.decisionComment,
      createdAt: l.createdAt.toISOString(),
      canCancel: l.employeeId === actor.employeeId && canCancel(l.status, toIso(l.startDate), today),
    })),
  };
}

function canCancel(status: LeaveStatus, start: string, today: string): boolean {
  return status === "PENDING" || (status === "APPROVED" && start > today);
}

/** The owner cancels while pending, or while approved and not yet started. */
export async function cancelLeave(actor: Session, id: string, now: Date = new Date()) {
  const l = await db.leaveRequest.findUnique({ where: { id } });
  if (!l) throw new HttpError(404, "Leave request not found", "not_found");
  if (!actor.employeeId || l.employeeId !== actor.employeeId) throw forbidden("You can only cancel your own leave.");
  if (!canCancel(l.status, toIso(l.startDate), todayIso(now))) {
    throw new HttpError(409, "Only pending leave, or approved leave that has not started, can be cancelled.", "conflict");
  }
  return db.$transaction(async (tx) => {
    // Conditional on the status we checked, so a concurrent approve/cancel cannot be overwritten silently.
    const { count } = await tx.leaveRequest.updateMany({ where: { id, status: l.status }, data: { status: "CANCELLED" } });
    if (!count) throw new HttpError(409, "This request changed in the meantime. Refresh and try again.", "conflict");
    const after = { status: "CANCELLED" as const };
    await audit(actor, "cancel", "leave_request", id, { before: { status: l.status }, after: { status: after.status } }, tx);
    if (l.status === "APPROVED" && l.decidedById) {
      await notify([l.decidedById], { title: "Approved leave cancelled", body: `${actor.name ?? "An employee"} cancelled ${toIso(l.startDate)} to ${toIso(l.endDate)}.`, link: "/leave" }, tx);
    }
    return { id, status: after.status };
  });
}

/**
 * HR approves or rejects (Admin can only view, #13). Approval re-checks overlap and balance,
 * because other leave may have been approved since the request was made.
 */
export async function decideLeave(actor: Session, id: string, input: { decision: "APPROVED" | "REJECTED"; comment?: string }) {
  assertRole(actor, "HR");
  if (input.decision === "REJECTED" && !input.comment) throw badRequest("A comment is required when rejecting.");
  const l = await db.leaveRequest.findUnique({ where: { id }, include: { employee: true, leaveType: true } });
  if (!l) throw new HttpError(404, "Leave request not found", "not_found");
  if (l.status !== "PENDING") throw new HttpError(409, `This request is already ${l.status.toLowerCase()}.`, "conflict");
  if (l.employeeId === actor.employeeId) throw forbidden("You cannot approve your own leave.");

  const [settings, holidays] = await Promise.all([getSettings(), getHolidaySet(toIso(l.startDate), toIso(l.endDate))]);
  const dates = workingDays(toIso(l.startDate), toIso(l.endDate), settings.weekendDays, holidays);

  return db.$transaction(async (tx) => {
    // Re-check everything under a per-employee lock: two HR users approving two requests at once
    // (which together exceed the balance), or the same request twice, must not both succeed.
    await lockEmployee(tx, l.employeeId);
    const current = await tx.leaveRequest.findUnique({ where: { id }, select: { status: true } });
    if (current?.status !== "PENDING") throw new HttpError(409, `This request is already ${current?.status.toLowerCase() ?? "gone"}.`, "conflict");
    if (input.decision === "APPROVED") {
      const overlap = await tx.leaveRequest.findFirst({
        where: { id: { not: id }, employeeId: l.employeeId, status: "APPROVED", startDate: { lte: l.endDate }, endDate: { gte: l.startDate } },
      });
      if (overlap) throw new HttpError(422, `Overlaps approved leave from ${toIso(overlap.startDate)} to ${toIso(overlap.endDate)}.`, "unprocessable");
      const { problems } = await balanceProblems(tx, l.employeeId, l.leaveType, dates);
      if (problems.length) throw new HttpError(422, problems.join(" "), "unprocessable");
    }
    // Conditional write: if the employee cancelled meanwhile, the request is no longer PENDING and nothing changes.
    const changed = await tx.leaveRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.decision, decidedById: actor.userId, decisionComment: input.comment || null },
    });
    if (changed.count === 0) throw new HttpError(409, "This request was already decided or cancelled.", "conflict");
    const after = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    await audit(
      actor,
      input.decision === "APPROVED" ? "approve" : "reject",
      "leave_request",
      id,
      { before: { status: l.status }, after: { status: after.status, comment: after.decisionComment } },
      tx,
    );
    await notify(
      [l.employee.userId],
      {
        title: `Leave ${input.decision === "APPROVED" ? "approved" : "rejected"}`,
        body: `${l.leaveType.name} ${toIso(l.startDate)} to ${toIso(l.endDate)}${input.comment ? `: ${input.comment}` : ""}`,
        link: "/leave",
      },
      tx,
    );
    return { id, status: after.status, comment: after.decisionComment };
  });
}
