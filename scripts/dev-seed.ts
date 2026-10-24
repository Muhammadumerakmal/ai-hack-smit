/**
 * DEV ONLY. Fills a LOCAL database with a small company so M8 can be tried before the other
 * modules exist. The real app starts empty (brief, Section 1); never run this against a hosted DB.
 *
 *   npm run dev:seed -- --yes
 */
import { PrismaClient } from "@prisma/client";
import { addDays, currentMonth, monthRange, todayIso, toDate, workingDays } from "../src/lib/dates";

export function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("dev-seed only runs against a localhost database outside production.");
  }
}

function monthlyTax(grossMonthly: number): number {
  const y = grossMonthly * 12;
  const annual =
    y <= 600_000 ? 0
    : y <= 1_200_000 ? (y - 600_000) * 0.05
    : y <= 2_400_000 ? 30_000 + (y - 1_200_000) * 0.15
    : y <= 3_600_000 ? 210_000 + (y - 2_400_000) * 0.25
    : 510_000 + (y - 3_600_000) * 0.35;
  return Math.round(annual / 12);
}

/** Wipes the local database and creates the demo company. Also used as the test fixture. */
export async function seedDemo(db: PrismaClient) {
  assertLocalDatabase();
  // Wipe in FK order.
  await db.aiLog.deleteMany();
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.announcement.deleteMany();
  await db.attendanceCorrection.deleteMany();
  await db.payslip.deleteMany();
  await db.payrollRun.deleteMany();
  await db.leaveRequest.deleteMany();
  await db.attendance.deleteMany();
  await db.employee.deleteMany();
  await db.user.deleteMany();
  await db.holiday.deleteMany();
  await db.leaveType.deleteMany();
  await db.designation.deleteMany();
  await db.department.deleteMany();
  await db.companySettings.deleteMany();

  const today = todayIso();
  const year = today.slice(0, 4);

  await db.companySettings.create({ data: { id: 1, companyName: "Demo Co", officeLat: 24.8607, officeLng: 67.0011 } });
  const [eng, sales, hrDept] = await Promise.all(
    ["Engineering", "Sales", "Human Resources"].map((name) => db.department.create({ data: { name } })),
  );
  const [dev, exec, hrOfficer] = await Promise.all(
    ["Software Engineer", "Sales Executive", "HR Officer"].map((title) => db.designation.create({ data: { title } })),
  );
  const types = Object.fromEntries(
    await Promise.all(
      [
        { code: "annual", name: "Annual", yearlyQuota: 14 },
        { code: "sick", name: "Sick", yearlyQuota: 8 },
        { code: "casual", name: "Casual", yearlyQuota: 10 },
        { code: "unpaid", name: "Unpaid", yearlyQuota: null, isPaid: false },
      ].map(async (t) => [t.code, await db.leaveType.create({ data: t })]),
    ),
  );
  await db.holiday.create({ data: { date: toDate(`${year}-12-25`), name: "Quaid-e-Azam Day" } });

  await db.user.create({ data: { email: "admin@demo.test", name: "Demo Admin", passwordHash: "dev-seed", role: "ADMIN" } });

  const people = [
    { code: "E001", name: "Hina Khan", email: "hr@demo.test", role: "HR" as const, dept: hrDept, des: hrOfficer, basic: 120_000 },
    { code: "E002", name: "Ali Raza", email: "ali@demo.test", role: "EMPLOYEE" as const, dept: eng, des: dev, basic: 150_000 },
    { code: "E003", name: "Sara Ahmed", email: "sara@demo.test", role: "EMPLOYEE" as const, dept: eng, des: dev, basic: 140_000 },
    { code: "E004", name: "Bilal Shah", email: "bilal@demo.test", role: "EMPLOYEE" as const, dept: sales, des: exec, basic: 80_000 },
    { code: "E005", name: "Zara Malik", email: "zara@demo.test", role: "EMPLOYEE" as const, dept: sales, des: exec, basic: 85_000 },
  ];
  const emp: Record<string, string> = {};
  for (const p of people) {
    const user = await db.user.create({ data: { email: p.email, passwordHash: "dev-seed", role: p.role } });
    const e = await db.employee.create({
      data: {
        code: p.code,
        fullName: p.name,
        email: p.email,
        departmentId: p.dept.id,
        designationId: p.des.id,
        joinDate: toDate(`${Number(year) - 1}-01-10`),
        status: "ACTIVE",
        basicSalary: p.basic,
        userId: user.id,
      },
    });
    emp[p.code] = e.id;
  }

  // Attendance for this month up to yesterday.
  const { start } = monthRange(currentMonth());
  const yesterday = addDays(today, -1);
  const days = start <= yesterday ? workingDays(start, yesterday, [0, 6], new Set()) : [];
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:00`);

  // Bilal: approved sick leave on the 4th and 5th working days.
  const bilalSick = days.slice(3, 5);
  if (bilalSick.length === 2) {
    await db.leaveRequest.create({
      data: { employeeId: emp.E004, leaveTypeId: types.sick.id, startDate: toDate(bilalSick[0]), endDate: toDate(bilalSick[1]), days: 2, reason: "Fever", status: "APPROVED" },
    });
  }
  // Sara: 1 approved sick day earlier this year → 7 sick days left.
  await db.leaveRequest.create({
    data: { employeeId: emp.E003, leaveTypeId: types.sick.id, startDate: toDate(`${year}-02-10`), endDate: toDate(`${year}-02-10`), days: 1, reason: "Doctor visit", status: "APPROVED" },
  });
  // Zara: approved casual leave covering today (if today is a working day it shows as on leave).
  await db.leaveRequest.create({
    data: { employeeId: emp.E005, leaveTypeId: types.casual.id, startDate: toDate(today), endDate: toDate(addDays(today, 1)), days: 2, reason: "Family event", status: "APPROVED" },
  });
  // Ali: a pending request, for the "pending approvals" KPI.
  await db.leaveRequest.create({
    data: { employeeId: emp.E002, leaveTypeId: types.annual.id, startDate: toDate(addDays(today, 14)), endDate: toDate(addDays(today, 15)), days: 2, reason: "Trip", status: "PENDING" },
  });

  const rows: { employeeId: string; date: Date; checkIn: Date; checkOut: Date | null; status: "PRESENT" | "LATE" | "HALF_DAY" }[] = [];
  days.forEach((day, i) => {
    const push = (code: string, inAt: string, outAt: string | null, status: "PRESENT" | "LATE" | "HALF_DAY") =>
      rows.push({ employeeId: emp[code], date: toDate(day), checkIn: at(day, inAt), checkOut: outAt ? at(day, outAt) : null, status });

    push("E001", "08:55", "17:30", "PRESENT");
    push("E002", i % 3 === 0 ? "09:40" : "09:05", "18:00", i % 3 === 0 ? "LATE" : "PRESENT"); // late every 3rd day
    if (i === 6) {
      // Sara absent (no record)
    } else if (i === 2) push("E003", "09:00", "12:30", "HALF_DAY");
    else push("E003", i === 1 || i === 8 ? "09:25" : "08:50", "17:00", i === 1 || i === 8 ? "LATE" : "PRESENT");
    if (!bilalSick.includes(day)) push("E004", i === 0 ? "09:20" : "09:10", i === 9 ? null : "17:15", i === 0 ? "LATE" : "PRESENT");
    push("E005", "09:00", "17:00", "PRESENT");
  });
  await db.attendance.createMany({ data: rows });

  // Last month's payroll, finalized, so employees have a payslip.
  const last = addDays(start, -1).slice(0, 7);
  const run = await db.payrollRun.create({ data: { month: last, status: "FINALIZED", createdById: "dev-seed", finalizedById: "dev-seed", finalizedAt: new Date() } });
  const lastRange = monthRange(last);
  const wd = workingDays(lastRange.start, lastRange.end, [0, 6], new Set()).length;
  for (const p of people) {
    const gross = p.basic * 1.5;
    const tax = monthlyTax(gross);
    await db.payslip.create({
      data: {
        runId: run.id, employeeId: emp[p.code], basic: p.basic, hra: p.basic * 0.4, medical: p.basic * 0.1,
        gross, deductions: 0, tax, net: gross - tax, workingDays: wd, paidDays: wd,
      },
    });
  }

  return { employees: emp, workingDaysSoFar: days, payrollMonth: last };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/dev-seed.ts")) {
  const db = new PrismaClient();
  (async () => {
    if (!process.argv.includes("--yes")) throw new Error("This wipes the local database. Re-run with --yes.");
    const r = await seedDemo(db);
    console.log(`Seeded Demo Co: 5 employees, ${r.workingDaysSoFar.length} working days of attendance, payroll ${r.payrollMonth}.`);
    console.log("Sign in at http://localhost:3000/assistant (dev links), e.g. hr@demo.test or sara@demo.test.");
  })()
    .catch((e) => {
      console.error(e.message ?? e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
