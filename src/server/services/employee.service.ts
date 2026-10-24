import type { EmployeeStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toDate, todayIso } from "@/lib/dates";
import { assertRole, type Session } from "@/lib/session";
import { resolveDepartmentId } from "./settings.service";

const COUNTED: EmployeeStatus[] = ["ACTIVE", "PROBATION"];

/** Section 7: headcount = active + probation on the end date. */
export async function getHeadcount(actor: Session, opts: { department?: string; asOf?: string } = {}) {
  assertRole(actor, "ADMIN", "HR");
  const asOf = opts.asOf ?? todayIso();
  const departmentId = await resolveDepartmentId(opts.department);

  const where: Prisma.EmployeeWhereInput = {
    status: { in: COUNTED },
    joinDate: { lte: toDate(asOf) },
    OR: [{ exitDate: null }, { exitDate: { gt: toDate(asOf) } }],
    ...(departmentId && { departmentId }),
  };

  const [byDept, byStatus] = await Promise.all([
    db.employee.groupBy({ by: ["departmentId"], where, _count: { _all: true } }),
    db.employee.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const depts = await db.department.findMany({ where: { id: { in: byDept.map((d) => d.departmentId) } } });
  const deptName = new Map(depts.map((d) => [d.id, d.name]));

  return {
    asOf,
    department: opts.department ?? "all",
    total: byStatus.reduce((n, s) => n + s._count._all, 0),
    active: byStatus.find((s) => s.status === "ACTIVE")?._count._all ?? 0,
    probation: byStatus.find((s) => s.status === "PROBATION")?._count._all ?? 0,
    byDepartment: byDept
      .map((d) => ({ department: deptName.get(d.departmentId) ?? "?", count: d._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function searchEmployees(
  actor: Session,
  opts: { query?: string; department?: string; status?: EmployeeStatus; limit?: number } = {},
) {
  assertRole(actor, "ADMIN", "HR");
  const departmentId = await resolveDepartmentId(opts.department);
  const q = opts.query?.trim();

  const rows = await db.employee.findMany({
    where: {
      ...(departmentId && { departmentId }),
      ...(opts.status && { status: opts.status }),
      ...(q && {
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      }),
    },
    include: { department: true, designation: true },
    orderBy: { fullName: "asc" },
    take: Math.min(opts.limit ?? 10, 25),
  });

  return rows.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.fullName,
    email: e.email,
    department: e.department.name,
    designation: e.designation?.title ?? null,
    status: e.status,
    joinDate: e.joinDate.toISOString().slice(0, 10),
    // Admin and HR may see salary structures (checklist #14); employees never reach this function.
    basicSalary: Number(e.basicSalary),
  }));
}
