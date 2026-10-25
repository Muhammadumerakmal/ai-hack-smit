import type { EmployeeStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isIsoDate, toDate, toIso, todayIso } from "@/lib/dates";
import { badRequest, forbidden, HttpError } from "@/lib/errors";
import { hashPassword, temporaryPassword } from "@/lib/password";
import { assertRole, scopeEmployeeId, type Session } from "@/lib/session";
import { getAttendanceSummary } from "./attendance.service";
import { getLeaveBalance } from "./leave.service";

// M3 Employees: HR registers and edits; Admin views; an Employee sees and edits only their own phone and address.

const STATUSES = ["ACTIVE", "PROBATION", "INACTIVE", "EXITED"] as const;

export const employeeSchema = z.object({
  code: z.string().trim().max(20).optional(),
  fullName: z.string().trim().min(2).max(80),
  email: z.email().transform((e) => e.toLowerCase()),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  departmentId: z.string().min(1, "Choose a department"),
  designationId: z.string().optional().nullable(),
  joinDate: z.string().refine(isIsoDate, "Use YYYY-MM-DD"),
  status: z.enum(STATUSES).default("PROBATION"),
  basicSalary: z.number().positive("Salary must be more than 0").max(100_000_000),
});

// Written out rather than employeeSchema.partial(): a .default() inside .optional() would still fill in
// status = PROBATION on every edit that leaves status out.
export const employeeUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  email: z
    .email()
    .transform((e) => e.toLowerCase())
    .optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  gender: z.enum(["male", "female", "other"]).nullable().optional(),
  departmentId: z.string().min(1).optional(),
  designationId: z.string().nullable().optional(),
  joinDate: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(),
  status: z.enum(STATUSES).optional(),
  basicSalary: z.number().positive("Salary must be more than 0").max(100_000_000).optional(),
  exitDate: z.string().refine(isIsoDate, "Use YYYY-MM-DD").nullable().optional(),
});

export const selfUpdateSchema = z.object({
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
});

/** Salary structure (Section 3, M6): gross = 1.5 × basic = basic + HRA 40% + medical 10%. */
export function salaryStructure(basic: number) {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { basic: r(basic), hra: r(basic * 0.4), medical: r(basic * 0.1), gross: r(basic * 1.5) };
}

async function nextEmployeeCode(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.employee.count();
  for (let n = count + 1; ; n++) {
    const code = `E${String(n).padStart(4, "0")}`;
    if (!(await tx.employee.findUnique({ where: { code } }))) return code;
  }
}

type NewEmployee = z.infer<typeof employeeSchema>;

interface TempCredentials {
  tempPassword: string;
  passwordHash: string;
}

/** bcrypt is deliberately slow (~70 ms); hash before opening a transaction so it stays short. */
async function newTempCredentials(): Promise<TempCredentials> {
  const tempPassword = temporaryPassword();
  return { tempPassword, passwordHash: await hashPassword(tempPassword) };
}

async function createEmployeeTx(tx: Prisma.TransactionClient, actor: Session, input: NewEmployee, creds?: TempCredentials) {
  const { tempPassword, passwordHash } = creds ?? (await newTempCredentials());
  const user = await tx.user.create({
    data: { email: input.email, name: input.fullName, role: "EMPLOYEE", passwordHash, mustChangePassword: true },
  });
  const emp = await tx.employee.create({
    data: {
      code: input.code || (await nextEmployeeCode(tx)),
      fullName: input.fullName,
      email: input.email,
      phone: input.phone || null,
      address: input.address || null,
      gender: input.gender || null,
      departmentId: input.departmentId,
      designationId: input.designationId || null,
      joinDate: toDate(input.joinDate),
      status: input.status,
      basicSalary: input.basicSalary,
      userId: user.id,
    },
  });
  await audit(actor, "create", "employee", emp.id, { after: { ...emp, basicSalary: input.basicSalary } }, tx);
  return { id: emp.id, code: emp.code, email: emp.email, fullName: emp.fullName, tempPassword };
}

/** HR registers an employee; this also creates their login with a one-time temporary password. */
export async function createEmployee(actor: Session, input: NewEmployee) {
  assertRole(actor, "HR");
  await assertKnownRefs(input.departmentId, input.designationId);
  if (await db.user.findUnique({ where: { email: input.email } })) throw new HttpError(409, "A login with this email already exists.", "conflict");
  const creds = await newTempCredentials();
  return db.$transaction((tx) => createEmployeeTx(tx, actor, input, creds));
}

async function assertKnownRefs(departmentId?: string, designationId?: string | null) {
  if (departmentId && !(await db.department.findUnique({ where: { id: departmentId } }))) throw badRequest("Unknown department");
  if (designationId && !(await db.designation.findUnique({ where: { id: designationId } }))) throw badRequest("Unknown designation");
}

export async function updateEmployee(actor: Session, id: string, raw: unknown) {
  const before = await db.employee.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Employee not found", "not_found");

  let data: Prisma.EmployeeUncheckedUpdateInput;
  // Anyone editing their own record (HR included) is self-service: phone and address only, never own salary or status.
  if (actor.role === "EMPLOYEE" || actor.employeeId === id) {
    if (actor.employeeId !== id) throw forbidden();
    data = selfUpdateSchema.parse(raw);
  } else {
    assertRole(actor, "HR");
    const input = employeeUpdateSchema.parse(raw);
    await assertKnownRefs(input.departmentId, input.designationId);
    if (input.email && input.email !== before.email && (await db.user.findUnique({ where: { email: input.email } }))) {
      throw new HttpError(409, "A login with this email already exists.", "conflict");
    }
    if (input.exitDate && input.exitDate < (input.joinDate ?? toIso(before.joinDate))) throw badRequest("Exit date cannot be before the join date.");
    data = {
      ...input,
      designationId: input.designationId === "" ? null : input.designationId,
      joinDate: input.joinDate ? toDate(input.joinDate) : undefined,
      exitDate: input.exitDate === undefined ? undefined : input.exitDate ? toDate(input.exitDate) : null,
    };
  }

  return db.$transaction(async (tx) => {
    const after = await tx.employee.update({ where: { id }, data });
    if (before.userId && (data.email || data.fullName)) {
      await tx.user.update({ where: { id: before.userId }, data: { email: after.email, name: after.fullName } });
    }
    // An employee who has left (or is made inactive) can no longer sign in; sessions are rejected immediately.
    if (before.userId && after.status !== before.status && (after.status === "EXITED" || after.status === "INACTIVE")) {
      await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
    }
    const salaryChanged = Number(before.basicSalary) !== Number(after.basicSalary);
    await audit(actor, salaryChanged ? "update_salary" : "update", "employee", id, { before, after }, tx);
    return { id: after.id };
  });
}

export async function listEmployees(
  actor: Session,
  q: { search?: string; departmentId?: string; status?: string; page?: number; pageSize?: number },
) {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(Math.max(q.pageSize ?? 20, 1), 100);
  const where: Prisma.EmployeeWhereInput = {
    ...(actor.role === "EMPLOYEE" && { id: actor.employeeId ?? "-" }),
    ...(q.departmentId && { departmentId: q.departmentId }),
    ...(q.status && STATUSES.includes(q.status as EmployeeStatus) && { status: q.status as EmployeeStatus }),
    ...(q.search?.trim() && {
      OR: ["fullName", "code", "email", "phone"].map((f) => ({ [f]: { contains: q.search!.trim(), mode: "insensitive" } })),
    }),
  };
  const [total, rows] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      include: { department: true, designation: true, user: { select: { isActive: true, role: true } } },
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    items: rows.map((e) => ({
      id: e.id,
      code: e.code,
      fullName: e.fullName,
      email: e.email,
      phone: e.phone,
      department: e.department.name,
      designation: e.designation?.title ?? null,
      status: e.status,
      joinDate: toIso(e.joinDate),
      role: e.user?.role ?? null,
      loginActive: e.user?.isActive ?? false,
    })),
  };
}

/** Employee 360: profile, salary structure, this month's attendance, leave balance and history, payslips. */
export async function getEmployee360(actor: Session, id: string) {
  scopeEmployeeId(actor, id); // employees: own record only
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      department: true,
      designation: true,
      user: { select: { isActive: true, role: true, email: true } },
      leaveRequests: { include: { leaveType: true }, orderBy: { startDate: "desc" }, take: 10 },
      payslips: { include: { run: true }, orderBy: { run: { month: "desc" } }, take: 12 },
      // Only whether a face is enrolled; the descriptor itself never leaves the attendance service.
      faceProfile: { select: { enrolledAt: true } },
    },
  });
  if (!e) throw new HttpError(404, "Employee not found", "not_found");

  const today = todayIso();
  const [attendance, balance] = await Promise.all([
    getAttendanceSummary(actor, { start: `${today.slice(0, 7)}-01`, end: today, employeeId: id }),
    getLeaveBalance(actor, { employeeId: id }),
  ]);

  return {
    profile: {
      id: e.id,
      code: e.code,
      fullName: e.fullName,
      email: e.email,
      phone: e.phone,
      address: e.address,
      gender: e.gender,
      departmentId: e.departmentId,
      department: e.department.name,
      designationId: e.designationId,
      designation: e.designation?.title ?? null,
      joinDate: toIso(e.joinDate),
      exitDate: e.exitDate ? toIso(e.exitDate) : null,
      status: e.status,
      role: e.user?.role ?? null,
      loginActive: e.user?.isActive ?? false,
    },
    salary: salaryStructure(Number(e.basicSalary)),
    faceCheckIn: { enrolled: !!e.faceProfile, enrolledAt: e.faceProfile?.enrolledAt.toISOString() ?? null },
    attendance,
    leaveBalance: balance.balances,
    leaves: e.leaveRequests.map((l) => ({
      id: l.id,
      type: l.leaveType.name,
      start: toIso(l.startDate),
      end: toIso(l.endDate),
      days: l.days,
      status: l.status,
      reason: l.reason,
    })),
    // Employees see finalized payslips only; drafts can still change.
    payslips: e.payslips
      .filter((p) => actor.role !== "EMPLOYEE" || p.run.status === "FINALIZED")
      .map((p) => ({ id: p.id, month: p.run.month, status: p.run.status, gross: Number(p.gross), net: Number(p.net) })),
  };
}

// ---------- CSV import / export (#08, HR) ----------

const CSV_COLUMNS = ["code", "full_name", "email", "phone", "department", "designation", "join_date", "basic_salary", "gender", "status"] as const;
const REQUIRED = ["code", "full_name", "email", "department", "join_date", "basic_salary"] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface ImportError {
  row: number;
  field: string;
  reason: string;
}

/**
 * Dry run returns every problem as row + field + reason and writes nothing.
 * A real import only runs when the file has no errors, and creates every row in one transaction.
 */
export async function importEmployeesCsv(actor: Session, csv: string, dryRun: boolean) {
  assertRole(actor, "HR");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw badRequest("The file needs a header row and at least one employee.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missingCols = REQUIRED.filter((c) => !header.includes(c));
  if (missingCols.length) throw badRequest(`Missing columns: ${missingCols.join(", ")}. Expected: ${CSV_COLUMNS.join(", ")}`);

  const [depts, desigs, existing] = await Promise.all([
    db.department.findMany(),
    db.designation.findMany(),
    db.employee.findMany({ select: { code: true, email: true } }),
  ]);
  const users = await db.user.findMany({ select: { email: true } });
  const deptByName = new Map(depts.map((d) => [d.name.toLowerCase(), d.id]));
  const desigByName = new Map(desigs.map((d) => [d.title.toLowerCase(), d.id]));
  const takenCodes = new Set(existing.map((e) => e.code.toLowerCase()));
  const takenEmails = new Set([...existing.map((e) => e.email.toLowerCase()), ...users.map((u) => u.email.toLowerCase())]);

  const errors: ImportError[] = [];
  const valid: NewEmployee[] = [];
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2; // 1-based, header is row 1
    const get = (col: string) => (cells[header.indexOf(col)] ?? "").trim();
    const err = (field: string, reason: string) => errors.push({ row: rowNo, field, reason });
    const before = errors.length;

    for (const col of REQUIRED) if (!get(col)) err(col, "required");
    const code = get("code");
    const email = get("email").toLowerCase();
    if (code && takenCodes.has(code.toLowerCase())) err("code", "already used");
    if (email && !z.email().safeParse(email).success) err("email", "not a valid email");
    else if (email && takenEmails.has(email)) err("email", "already used");
    const deptId = deptByName.get(get("department").toLowerCase());
    if (get("department") && !deptId) err("department", `unknown department "${get("department")}"`);
    const desig = get("designation");
    if (desig && !desigByName.has(desig.toLowerCase())) err("designation", `unknown designation "${desig}"`);
    if (get("join_date") && !isIsoDate(get("join_date"))) err("join_date", "use YYYY-MM-DD");
    const salary = Number(get("basic_salary").replace(/,/g, ""));
    if (get("basic_salary") && !(salary > 0)) err("basic_salary", "must be a number greater than 0");
    const gender = get("gender").toLowerCase();
    if (gender && !["male", "female", "other"].includes(gender)) err("gender", "use male, female or other");
    const status = (get("status") || "PROBATION").toUpperCase();
    if (!STATUSES.includes(status as EmployeeStatus)) err("status", `use one of ${STATUSES.join(", ")}`);

    // Duplicates inside the same file count too.
    if (code) takenCodes.add(code.toLowerCase());
    if (email) takenEmails.add(email);

    if (errors.length === before) {
      valid.push({
        code,
        fullName: get("full_name"),
        email,
        phone: get("phone") || null,
        address: null,
        gender: (gender || null) as NewEmployee["gender"],
        departmentId: deptId!,
        designationId: desig ? desigByName.get(desig.toLowerCase())! : null,
        joinDate: get("join_date"),
        status: status as EmployeeStatus,
        basicSalary: salary,
      });
    }
  });

  const total = rows.length - 1;
  if (dryRun || errors.length) return { dryRun: true, total, valid: valid.length, errors, created: [] };

  // Hash every temporary password first; the transaction then only does fast inserts.
  const creds: TempCredentials[] = [];
  for (let i = 0; i < valid.length; i += 8) creds.push(...(await Promise.all(valid.slice(i, i + 8).map(() => newTempCredentials()))));
  const created = await db.$transaction(async (tx) => {
    const out = [];
    for (const [i, e] of valid.entries()) out.push(await createEmployeeTx(tx, actor, e, creds[i]));
    await audit(actor, "import", "employee", null, { after: { count: out.length } }, tx);
    return out;
  }, { timeout: 60_000 });
  return { dryRun: false, total, valid: valid.length, errors: [], created };
}

export async function exportEmployeesCsv(actor: Session): Promise<string> {
  assertRole(actor, "HR"); // checklist #08: HR only
  const rows = await db.employee.findMany({ include: { department: true, designation: true }, orderBy: { code: "asc" } });
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((e) =>
      [e.code, e.fullName, e.email, e.phone, e.department.name, e.designation?.title, toIso(e.joinDate), Number(e.basicSalary), e.gender, e.status]
        .map(csvCell)
        .join(","),
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}
