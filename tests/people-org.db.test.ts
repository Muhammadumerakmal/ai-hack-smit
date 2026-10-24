import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as employees from "@/app/api/employees/route";
import * as employeeById from "@/app/api/employees/[id]/route";
import * as exportCsv from "@/app/api/employees/export/route";
import * as importCsv from "@/app/api/employees/import/route";
import * as departments from "@/app/api/org/departments/route";
import * as departmentById from "@/app/api/org/departments/[id]/route";
import * as holidays from "@/app/api/org/holidays/route";
import * as holidayById from "@/app/api/org/holidays/[id]/route";
import * as leaveTypes from "@/app/api/org/leave-types/route";
import * as leaveTypeById from "@/app/api/org/leave-types/[id]/route";
import * as settings from "@/app/api/org/settings/route";
import { parseCsv } from "@/server/services/people.service";
import { call, hasDb, seed } from "./helpers";

describe.skipIf(!hasDb)("M3 employees + M2 organization", () => {
  const db = new PrismaClient();
  let u: Record<string, string>; // user ids by email prefix
  let e: Record<string, string>; // employee ids by code
  let dept: Record<string, string>;

  beforeAll(async () => {
    await seed(db);
    const users = await db.user.findMany({ include: { employee: true } });
    u = Object.fromEntries(users.map((x) => [x.email.split("@")[0], x.id]));
    e = Object.fromEntries(users.filter((x) => x.employee).map((x) => [x.employee!.code, x.employee!.id]));
    dept = Object.fromEntries((await db.department.findMany()).map((d) => [d.name, d.id]));
  });
  afterAll(() => db.$disconnect());

  describe("register and edit employees (#06, #14)", () => {
    const newHire = () => ({ fullName: "Usman Tariq", email: "Usman@Demo.test", departmentId: dept.Engineering, joinDate: "2026-10-20", basicSalary: 110000 });

    it("only HR can register an employee", async () => {
      expect((await call(employees.POST, { userId: u.sara, body: newHire() })).status).toBe(403);
      expect((await call(employees.POST, { userId: u.admin, body: newHire() })).status).toBe(403);
    });

    it("HR registers an employee: login created, temp password returned once, code generated, audited", async () => {
      const r = await call(employees.POST, { userId: u.hr, body: newHire() });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ email: "usman@demo.test", code: "E0006" });
      expect(r.body.tempPassword).toBeTruthy();

      const user = await db.user.findUniqueOrThrow({ where: { email: "usman@demo.test" }, include: { employee: true } });
      expect(user).toMatchObject({ role: "EMPLOYEE", mustChangePassword: true });
      expect(user.passwordHash).not.toContain(r.body.tempPassword);
      expect(user.employee).toMatchObject({ status: "PROBATION", fullName: "Usman Tariq" });
      expect(await db.auditLog.count({ where: { entity: "employee", action: "create", entityId: user.employee!.id } })).toBe(1);
    });

    it("rejects a duplicate email (409) and invalid input (400)", async () => {
      expect((await call(employees.POST, { userId: u.hr, body: { ...newHire(), email: "sara@demo.test" } })).status).toBe(409);
      expect((await call(employees.POST, { userId: u.hr, body: { ...newHire(), email: "x1@demo.test", basicSalary: 0 } })).status).toBe(400);
      expect((await call(employees.POST, { userId: u.hr, body: { ...newHire(), email: "x2@demo.test", joinDate: "20/10/2026" } })).status).toBe(400);
      expect((await call(employees.POST, { userId: u.hr, body: { ...newHire(), email: "x3@demo.test", departmentId: "nope" } })).status).toBe(400);
    });

    it("HR edits salary and details; untouched fields (like status) stay as they were", async () => {
      const r = await call(employeeById.PATCH, { userId: u.hr, params: { id: e.E003 }, body: { basicSalary: 150000, phone: "0300-1111111" } });
      expect(r.status).toBe(200);
      const sara = await db.employee.findUniqueOrThrow({ where: { id: e.E003 } });
      expect(Number(sara.basicSalary)).toBe(150000);
      expect(sara.status).toBe("ACTIVE");
      expect(await db.auditLog.count({ where: { action: "update_salary", entityId: e.E003 } })).toBe(1);
    });

    it("HR records an exit; exit before join is refused", async () => {
      expect((await call(employeeById.PATCH, { userId: u.hr, params: { id: e.E005 }, body: { exitDate: "2020-01-01" } })).status).toBe(400);
      expect((await call(employeeById.PATCH, { userId: u.hr, params: { id: e.E005 }, body: { status: "EXITED", exitDate: "2026-12-31" } })).status).toBe(200);
      await call(employeeById.PATCH, { userId: u.hr, params: { id: e.E005 }, body: { status: "ACTIVE", exitDate: null } });
    });

    it("HR cannot raise their own salary: own record is self-service only", async () => {
      const r = await call(employeeById.PATCH, { userId: u.hr, params: { id: e.E001 }, body: { basicSalary: 999999, phone: "0321-0000000" } });
      expect(r.status).toBe(200);
      const hina = await db.employee.findUniqueOrThrow({ where: { id: e.E001 } });
      expect(Number(hina.basicSalary)).toBe(120000);
      expect(hina.phone).toBe("0321-0000000");
    });

    it("Admin can view but not edit", async () => {
      expect((await call(employeeById.GET, { userId: u.admin, params: { id: e.E002 } })).status).toBe(200);
      expect((await call(employeeById.PATCH, { userId: u.admin, params: { id: e.E002 }, body: { phone: "1" } })).status).toBe(403);
    });

    it("an employee edits only their own phone and address; salary, role and others' records are off limits", async () => {
      const own = await call(employeeById.PATCH, { userId: u.ali, params: { id: e.E002 }, body: { phone: "0333-2222222", address: "Karachi", basicSalary: 999999, status: "ACTIVE" } });
      expect(own.status).toBe(200);
      const ali = await db.employee.findUniqueOrThrow({ where: { id: e.E002 } });
      expect(ali).toMatchObject({ phone: "0333-2222222", address: "Karachi" });
      expect(Number(ali.basicSalary)).toBe(150000); // unchanged
      expect((await call(employeeById.PATCH, { userId: u.ali, params: { id: e.E003 }, body: { phone: "1" } })).status).toBe(403);
    });
  });

  describe("directory and Employee 360 (#07)", () => {
    it("searches, filters and pages on the server", async () => {
      const all = await call(employees.GET, { userId: u.hr, url: "/api/employees?pageSize=2&page=1" });
      expect(all.body).toMatchObject({ page: 1, pageSize: 2, total: 6 });
      expect(all.body.items).toHaveLength(2);
      const page3 = await call(employees.GET, { userId: u.hr, url: "/api/employees?pageSize=2&page=3" });
      expect(page3.body.items).toHaveLength(2);

      const search = await call(employees.GET, { userId: u.admin, url: "/api/employees?search=sara" });
      expect(search.body.items.map((x: { fullName: string }) => x.fullName)).toEqual(["Sara Ahmed"]);
      const sales = await call(employees.GET, { userId: u.hr, url: `/api/employees?departmentId=${dept.Sales}` });
      expect(sales.body.total).toBe(2);
      const probation = await call(employees.GET, { userId: u.hr, url: "/api/employees?status=PROBATION" });
      expect(probation.body.items.map((x: { code: string }) => x.code)).toEqual(["E0006"]);
    });

    it("an employee's directory shows only themselves", async () => {
      const r = await call(employees.GET, { userId: u.sara, url: "/api/employees?search=ali" });
      expect(r.body.total).toBe(0);
      const own = await call(employees.GET, { userId: u.sara });
      expect(own.body.items.map((x: { code: string }) => x.code)).toEqual(["E003"]);
    });

    it("Employee 360: own record allowed, anyone else's is 403", async () => {
      const own = await call(employeeById.GET, { userId: u.sara, params: { id: e.E003 } });
      expect(own.status).toBe(200);
      expect(own.body.salary).toEqual({ basic: 150000, hra: 60000, medical: 15000, gross: 225000 });
      expect(own.body.leaveBalance.find((b: { type: string }) => b.type === "sick")).toMatchObject({ remaining: 7 });
      expect(own.body.attendance).toHaveProperty("attendanceRatePct");
      expect(own.body.payslips.every((p: { status: string }) => p.status === "FINALIZED")).toBe(true);

      expect((await call(employeeById.GET, { userId: u.sara, params: { id: e.E002 } })).status).toBe(403);
      expect((await call(employeeById.GET, { userId: u.hr, params: { id: "missing" } })).status).toBe(404);
    });
  });

  describe("CSV import / export (#08)", () => {
    const header = "code,full_name,email,phone,department,designation,join_date,basic_salary,gender,status";

    it("parses quoted fields, commas and CRLF", () => {
      expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    });

    it("dry run reports row + field + reason for every rule and writes nothing", async () => {
      const csv = [
        header,
        "E100,,a@demo.test,,Sales,,2026-01-01,50000,,", //               row 2: full_name required
        "E002,Dup Code,b@demo.test,,Sales,,2026-01-01,50000,,", //         row 3: code already used
        "E101,Bad Mail,not-an-email,,Sales,,2026-01-01,50000,,", //        row 4: invalid email
        "E102,Taken Mail,sara@demo.test,,Sales,,2026-01-01,50000,,", //    row 5: email already used
        "E103,No Dept,c@demo.test,,Marketing,,2026-01-01,50000,,", //      row 6: unknown department
        "E104,Bad Date,d@demo.test,,Sales,,01/02/2026,50000,,", //         row 7: not ISO
        "E105,Zero Pay,e@demo.test,,Sales,,2026-01-01,0,,", //             row 8: salary > 0
        "E106,Good One,f@demo.test,,Sales,Sales Executive,2026-01-01,\"60,000\",female,ACTIVE", // row 9: valid
        "E106,Same Code,g@demo.test,,Sales,,2026-01-01,50000,,", //        row 10: duplicate inside the file
      ].join("\n");
      const before = await db.employee.count();
      const r = await call(importCsv.POST, { userId: u.hr, body: { csv, dryRun: true } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ dryRun: true, total: 9, valid: 1 });
      const errs = r.body.errors.map((x: { row: number; field: string }) => `${x.row}:${x.field}`);
      expect(errs).toEqual(["2:full_name", "3:code", "4:email", "5:email", "6:department", "7:join_date", "8:basic_salary", "10:code"]);
      expect(r.body.errors[4].reason).toMatch(/unknown department "Marketing"/);
      expect(await db.employee.count()).toBe(before);

      // A file with errors is never partially imported, even when dryRun is false.
      const real = await call(importCsv.POST, { userId: u.hr, body: { csv, dryRun: false } });
      expect(real.body.created).toEqual([]);
      expect(await db.employee.count()).toBe(before);
    });

    it("a clean file imports every row with a login and temporary password", async () => {
      const csv = [header, "E200,Hamza Ali,hamza@demo.test,,Engineering,,2026-09-01,95000,male,ACTIVE", "E201,Mehwish R,mehwish@demo.test,,Sales,,2026-09-15,70000,female,"].join("\n");
      const r = await call(importCsv.POST, { userId: u.hr, body: { csv, dryRun: false } });
      expect(r.body).toMatchObject({ dryRun: false, valid: 2, errors: [] });
      expect(r.body.created).toHaveLength(2);
      const hamza = await db.user.findUniqueOrThrow({ where: { email: "hamza@demo.test" }, include: { employee: true } });
      expect(hamza).toMatchObject({ role: "EMPLOYEE", mustChangePassword: true });
      expect(hamza.employee?.code).toBe("E200");
    });

    it("rejects files missing required columns, and non-HR callers", async () => {
      expect((await call(importCsv.POST, { userId: u.hr, body: { csv: "name,email\nx,y", dryRun: true } })).status).toBe(400);
      expect((await call(importCsv.POST, { userId: u.admin, body: { csv: header, dryRun: true } })).status).toBe(403);
    });

    it("exports a CSV the import accepts (HR only)", async () => {
      const r = await call(exportCsv.GET, { userId: u.hr });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toMatch(/text\/csv/);
      expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="employees-/);
      const rows = parseCsv(r.body as string);
      expect(rows[0].join(",")).toBe(header);
      expect(rows.length).toBe(1 + (await db.employee.count()));
      expect((await call(exportCsv.GET, { userId: u.sara })).status).toBe(403);
    });
  });

  describe("organization setup (#03, #04)", () => {
    const company = { companyName: "Demo Co", officeStart: "09:30", graceMinutes: 10, halfDayHours: 4.5, weekendDays: [0, 6], officeLat: 24.86, officeLng: 67.0, radiusMeters: 200 };

    it("Admin edits company settings; HR can view but not change", async () => {
      expect((await call(settings.GET, { userId: u.hr })).status).toBe(200);
      expect((await call(settings.GET, { userId: u.sara })).status).toBe(403);
      expect((await call(settings.PUT, { method: "PUT", userId: u.hr, body: company })).status).toBe(403);
      const r = await call(settings.PUT, { method: "PUT", userId: u.admin, body: company });
      expect(r.status).toBe(200);
      expect((await call(settings.GET, { userId: u.hr })).body).toMatchObject({ officeStart: "09:30", graceMinutes: 10, radiusMeters: 200 });
      expect((await call(settings.PUT, { method: "PUT", userId: u.admin, body: { ...company, officeStart: "9am" } })).status).toBe(400);
      expect(await db.auditLog.count({ where: { entity: "settings" } })).toBe(1);
    });

    it("departments: anyone signed in can list, Admin manages, non-empty ones cannot be deleted", async () => {
      expect((await call(departments.GET, { userId: u.sara })).body.items.length).toBe(3);
      expect((await call(departments.POST, { userId: u.hr, body: { name: "Finance" } })).status).toBe(403);
      const fin = await call(departments.POST, { userId: u.admin, body: { name: "Finance" } });
      expect(fin.status).toBe(200);
      expect((await call(departments.POST, { userId: u.admin, body: { name: "Finance" } })).status).toBe(409);
      expect((await call(departmentById.PATCH, { method: "PATCH", userId: u.admin, params: { id: fin.body.id }, body: { name: "Accounts" } })).body.name).toBe("Accounts");
      expect((await call(departmentById.DELETE, { method: "DELETE", userId: u.admin, params: { id: dept.Sales } })).status).toBe(400);
      expect((await call(departmentById.DELETE, { method: "DELETE", userId: u.admin, params: { id: fin.body.id } })).status).toBe(200);
    });

    it("leave types: Admin adds and edits quotas", async () => {
      expect((await call(leaveTypes.GET, { userId: u.sara })).body.items.length).toBe(4);
      const body = { code: "maternity", name: "Maternity", yearlyQuota: 90, isPaid: true };
      expect((await call(leaveTypes.POST, { userId: u.hr, body })).status).toBe(403);
      const r = await call(leaveTypes.POST, { userId: u.admin, body });
      expect(r.status).toBe(200);
      const upd = await call(leaveTypeById.PATCH, { method: "PATCH", userId: u.admin, params: { id: r.body.id }, body: { ...body, yearlyQuota: 84 } });
      expect(upd.body.yearlyQuota).toBe(84);
      expect((await call(leaveTypes.POST, { userId: u.admin, body: { ...body, code: "Bad Code!" } })).status).toBe(400);
    });

    it("holidays: Admin adds and removes; listed by year", async () => {
      const r = await call(holidays.POST, { userId: u.admin, body: { date: "2026-08-14", name: "Independence Day" } });
      expect(r.status).toBe(200);
      const list = await call(holidays.GET, { userId: u.ali, url: "/api/org/holidays?year=2026" });
      expect(list.body.items.map((h: { date: string }) => h.date)).toContain("2026-08-14");
      expect((await call(holidays.POST, { userId: u.admin, body: { date: "2026-08-14", name: "Dup" } })).status).toBe(409);
      expect((await call(holidayById.DELETE, { method: "DELETE", userId: u.hr, params: { id: r.body.id } })).status).toBe(403);
      expect((await call(holidayById.DELETE, { method: "DELETE", userId: u.admin, params: { id: r.body.id } })).status).toBe(200);
    });
  });
});
