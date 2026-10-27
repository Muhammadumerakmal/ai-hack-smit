import type { PrismaClient } from "@prisma/client";
import type { Session } from "@/lib/session";

/**
 * A small, fully controlled company for February 2026 (QA-3). Every expected number in the biz-*
 * tests is worked out by hand from this data — not by calling the service under test.
 *
 * Settings: office 09:00, grace 15, half day < 5 h, weekend Sat+Sun. Holiday: Thu 2026-02-05.
 * Working days in Feb 2026 = 20 weekdays − 1 holiday = 19.
 *
 *  A  Engineering  ACTIVE     joined 2025-01-01  basic 100,000
 *     late 2,3 · half day 4 · absent 6 · missing checkout 9 · approved casual leave 10–11 · present the rest (12)
 *  B  Sales        PROBATION  joined 2026-02-16  basic  60,000   present 16–27 (10 days), late 17 and 18
 *  C  Engineering  EXITED     exit   2026-02-12  basic  80,000   present 2–11 (7 days), absent 12
 *  D  Engineering  INACTIVE                      basic  70,000   one record on the 2nd (must be ignored)
 *  E  Sales        ACTIVE     joined 2025-01-01  basic  50,000   approved UNPAID leave 23–27, present 2–20 (15 days)
 *
 * HR user has no employee record (so HR's own leave/attendance never mixes into the numbers).
 */
export const FEB = { start: "2026-02-01", end: "2026-02-28", month: "2026-02" };
const HOLIDAY = "2026-02-05";

export function febWorkingDays(): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 28; d++) {
    const iso = `2026-02-${String(d).padStart(2, "0")}`;
    const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && iso !== HOLIDAY) out.push(iso);
  }
  return out;
}

const pk = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:00`);

export async function truncateAll(db: PrismaClient) {
  await db.$executeRawUnsafe(
    `TRUNCATE ai_logs, audit_logs, notifications, announcements, payslips, payroll_runs, attendance_corrections, leave_requests, attendance, employees, users, holidays, leave_types, designations, departments, settings RESTART IDENTITY CASCADE`,
  );
}

export async function buildFebCompany(db: PrismaClient) {
  await truncateAll(db);
  await db.companySettings.create({ data: { id: 1, companyName: "QA Co" } });
  await db.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('settings', 'id'), (SELECT MAX(id) FROM settings))`);
  const eng = await db.department.create({ data: { companyId: 1, name: "Engineering" } });
  const sales = await db.department.create({ data: { companyId: 1, name: "Sales" } });
  const types = {
    annual: await db.leaveType.create({ data: { companyId: 1, code: "annual", name: "Annual", yearlyQuota: 14 } }),
    sick: await db.leaveType.create({ data: { companyId: 1, code: "sick", name: "Sick", yearlyQuota: 8 } }),
    casual: await db.leaveType.create({ data: { companyId: 1, code: "casual", name: "Casual", yearlyQuota: 10 } }),
    unpaid: await db.leaveType.create({ data: { companyId: 1, code: "unpaid", name: "Unpaid", yearlyQuota: null, isPaid: false } }),
  };
  await db.holiday.create({ data: { companyId: 1, date: new Date(`${HOLIDAY}T00:00:00Z`), name: "Kashmir Day" } });

  const admin = await db.user.create({ data: { companyId: 1, email: "admin@qa.test", name: "QA Admin", passwordHash: "x", role: "ADMIN" } });
  const hr = await db.user.create({ data: { companyId: 1, email: "hr@qa.test", name: "QA HR", passwordHash: "x", role: "HR" } });
  const hr2 = await db.user.create({ data: { companyId: 1, email: "hr2@qa.test", name: "QA HR 2", passwordHash: "x", role: "HR" } });

  const mk = async (code: string, name: string, deptId: string, join: string, status: "ACTIVE" | "PROBATION" | "EXITED" | "INACTIVE", basic: number, exit?: string) => {
    const u = await db.user.create({ data: { companyId: 1, email: `${code.toLowerCase()}@qa.test`, name, passwordHash: "x", role: "EMPLOYEE" } });
    return db.employee.create({
      data: { companyId: 1,
        code,
        fullName: name,
        email: `${code.toLowerCase()}@qa.test`,
        departmentId: deptId,
        joinDate: new Date(`${join}T00:00:00Z`),
        exitDate: exit ? new Date(`${exit}T00:00:00Z`) : null,
        status,
        basicSalary: basic,
        userId: u.id,
      },
    });
  };
  const A = await mk("A", "Aisha A", eng.id, "2025-01-01", "ACTIVE", 100_000);
  const B = await mk("B", "Bilal B", sales.id, "2026-02-16", "PROBATION", 60_000);
  const C = await mk("C", "Chand C", eng.id, "2025-06-01", "EXITED", 80_000, "2026-02-12");
  const D = await mk("D", "Danish D", eng.id, "2025-01-01", "INACTIVE", 70_000);
  const E = await mk("E", "Erum E", sales.id, "2025-01-01", "ACTIVE", 50_000);

  const days = febWorkingDays();
  type Row = { employeeId: string; date: Date; checkIn: Date; checkOut: Date | null; status: "PRESENT" | "LATE" | "HALF_DAY" };
  const rows: Row[] = [];
  const add = (employeeId: string, date: string, status: Row["status"], checkOut: string | null = "17:00") =>
    rows.push({
      employeeId,
      date: new Date(`${date}T00:00:00Z`),
      checkIn: pk(date, status === "LATE" ? "09:30" : "09:00"),
      checkOut: checkOut ? pk(date, checkOut) : null,
      status,
    });

  for (const d of days) {
    // A
    if (d === "2026-02-02" || d === "2026-02-03") add(A.id, d, "LATE");
    else if (d === "2026-02-04") add(A.id, d, "HALF_DAY", "12:00");
    else if (d === "2026-02-06" || d === "2026-02-10" || d === "2026-02-11") {
      // absent (6) / on approved leave (10, 11)
    } else if (d === "2026-02-09") add(A.id, d, "PRESENT", null);
    else add(A.id, d, "PRESENT");
    // B (joined 16th)
    if (d >= "2026-02-16") add(B.id, d, d === "2026-02-17" || d === "2026-02-18" ? "LATE" : "PRESENT");
    // C (left 12th; absent on the 12th)
    if (d <= "2026-02-11") add(C.id, d, "PRESENT");
    // E (unpaid leave 23–27)
    if (d <= "2026-02-20") add(E.id, d, "PRESENT");
  }
  add(D.id, "2026-02-02", "PRESENT");
  // Boundary noise that must NOT be counted in February.
  add(A.id, "2026-01-30", "LATE");
  add(A.id, "2026-03-02", "LATE");
  await db.attendance.createMany({ data: rows.map((r) => ({ companyId: 1, ...r })) });

  await db.leaveRequest.create({
    data: { companyId: 1, employeeId: A.id, leaveTypeId: types.casual.id, startDate: new Date("2026-02-10T00:00:00Z"), endDate: new Date("2026-02-11T00:00:00Z"), days: 2, reason: "Family", status: "APPROVED" },
  });
  await db.leaveRequest.create({
    data: { companyId: 1, employeeId: E.id, leaveTypeId: types.unpaid.id, startDate: new Date("2026-02-23T00:00:00Z"), endDate: new Date("2026-02-27T00:00:00Z"), days: 5, reason: "Unpaid", status: "APPROVED" },
  });

  const session = (u: { id: string; role: Session["role"]; name: string }, employeeId: string | null = null): Session => ({ userId: u.id, companyId: 1, role: u.role, employeeId, name: u.name });
  const empSession = async (e: { id: string; userId: string | null; fullName: string }) => ({ userId: e.userId!, companyId: 1, role: "EMPLOYEE" as const, employeeId: e.id, name: e.fullName });

  return {
    depts: { eng, sales },
    types,
    emp: { A, B, C, D, E },
    admin: session(admin),
    hr: session(hr),
    hr2: session(hr2),
    as: { A: await empSession(A), B: await empSession(B), C: await empSession(C), E: await empSession(E) },
  };
}
