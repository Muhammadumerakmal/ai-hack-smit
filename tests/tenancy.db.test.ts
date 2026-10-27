import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as announcements from "@/app/api/announcements/route";
import * as audit from "@/app/api/audit/route";
import * as me from "@/app/api/auth/me/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as employees from "@/app/api/employees/route";
import * as employeeById from "@/app/api/employees/[id]/route";
import * as leaveRequests from "@/app/api/leave-requests/route";
import * as leaveDecision from "@/app/api/leave-requests/[id]/decision/route";
import * as departments from "@/app/api/org/departments/route";
import * as settings from "@/app/api/org/settings/route";
import * as payrollRuns from "@/app/api/payroll/runs/route";
import * as payslipPdf from "@/app/api/payslips/[id]/pdf/route";
import * as setup from "@/app/api/setup/route";
import * as users from "@/app/api/users/route";
import * as resetPw from "@/app/api/users/[id]/reset-password/route";
import { scopeArgs } from "@/lib/db";
import { runInCompany } from "@/lib/tenant";
import { runTool } from "@/server/ai/tools";
import { resetCompanyThrottle } from "@/server/services/auth.service";
import { call, hasDb, seed, sessionFor } from "./helpers";

// Companies are separate: a company created by a new visitor never sees or changes another company's data.
// Company 1 is the demo company (Ali, Sara, …); company 2 is created through "Create your company".

describe("scopeArgs (the company filter added to every query)", () => {
  it("adds the company to where, to created rows, and to the upsert create", () => {
    expect(scopeArgs("Employee", "findMany", { where: { status: "ACTIVE" } }, 7)).toEqual({ where: { status: "ACTIVE", companyId: 7 } });
    expect(scopeArgs("Employee", "findUnique", { where: { id: "x" } }, 7)).toEqual({ where: { id: "x", companyId: 7 } });
    // A caller can't widen the scope by passing another company.
    expect(scopeArgs("Employee", "count", { where: { companyId: 1 } }, 7)).toEqual({ where: { companyId: 7 } });
    expect(scopeArgs("Department", "create", { data: { name: "Ops", companyId: 1 } }, 7)).toEqual({ data: { name: "Ops", companyId: 7 } });
    expect(scopeArgs("Attendance", "createMany", { data: [{ a: 1 }, { a: 2 }] }, 7)).toEqual({ data: [{ a: 1, companyId: 7 }, { a: 2, companyId: 7 }] });
    expect(scopeArgs("ChatConversation", "upsert", { where: { id: "c" }, create: { id: "c" }, update: {} }, 7)).toEqual({
      where: { id: "c", companyId: 7 },
      create: { id: "c", companyId: 7 },
      update: {},
    });
    // The company row itself is matched by its id.
    expect(scopeArgs("CompanySettings", "findUnique", { where: { id: 1 } }, 7)).toEqual({ where: { id: 7 } });
  });
});

describe.skipIf(!hasDb)("multi-company isolation", () => {
  const db = new PrismaClient();
  let c1: Record<string, string>; // company 1 user ids by email prefix
  let c1Employee: string;
  let c1LeaveRequest: string;
  let c1Payslip: string;
  let owner: string; // company 2 Admin
  const C1_NAMES = ["Ali Raza", "Sara Ahmed", "Hina Khan", "Demo Co", "ali@demo.test"];

  beforeAll(async () => {
    await seed(db);
    const all = await db.user.findMany({ include: { employee: true } });
    c1 = Object.fromEntries(all.map((u) => [u.email.split("@")[0], u.id]));
    c1Employee = all.find((u) => u.email === "ali@demo.test")!.employee!.id;
    c1LeaveRequest = (await db.leaveRequest.findFirstOrThrow()).id;
    c1Payslip = (await db.payslip.findFirstOrThrow()).id;

    resetCompanyThrottle();
    const created = await call(setup.POST, { body: { companyName: "Judge Co", adminName: "Judge", adminEmail: "judge@judge.test", adminPassword: "secret123" } });
    expect(created.status).toBe(200);
    owner = (await db.user.findUniqueOrThrow({ where: { email: "judge@judge.test" } })).id;
  });
  afterAll(() => db.$disconnect());

  it("the new company is company 2 and the demo company is untouched", async () => {
    expect((await db.user.findUniqueOrThrow({ where: { id: owner } })).companyId).toBe(2);
    expect((await call(me.GET, { userId: owner })).body).toMatchObject({ role: "ADMIN", companyName: "Judge Co" });
    expect((await call(me.GET, { userId: c1.admin })).body).toMatchObject({ companyName: "Demo Co" });
  });

  it("lists only its own data: no employees, users, payroll, leave, announcements or audit from company 1", async () => {
    const reads = await Promise.all([
      call(employees.GET, { userId: owner }),
      call(users.GET, { userId: owner }),
      call(payrollRuns.GET, { userId: owner }),
      call(leaveRequests.GET, { userId: owner }),
      call(announcements.GET, { userId: owner }),
      call(audit.GET, { userId: owner }),
      call(departments.GET, { userId: owner }),
      call(dashboard.GET, { userId: owner }),
      call(settings.GET, { userId: owner }),
    ]);
    for (const r of reads) {
      expect(r.status).toBe(200);
      const json = JSON.stringify(r.body);
      for (const name of C1_NAMES) expect(json).not.toContain(name);
    }
    expect((reads[1].body as { items?: unknown[] }).items ?? reads[1].body).toHaveLength(1); // just the owner
  });

  it("can't open or change company 1's records by id (404, never another company's data)", async () => {
    expect((await call(employeeById.GET, { userId: owner, params: { id: c1Employee } })).status).toBe(404);
    expect((await call(employeeById.PATCH, { userId: owner, params: { id: c1Employee }, body: { phone: "0300" } })).status).toBe(404);
    expect((await call(payslipPdf.GET, { userId: owner, params: { id: c1Payslip } })).status).toBe(404);
    expect((await call(resetPw.POST, { userId: owner, params: { id: c1.ali } })).status).toBe(404);
    const decision = await call(leaveDecision.POST, { userId: owner, params: { id: c1LeaveRequest }, body: { decision: "APPROVED", comment: "x" } });
    expect([403, 404]).toContain(decision.status); // Admin can't decide leave at all, and the id isn't visible either
    expect((await db.employee.findUniqueOrThrow({ where: { id: c1Employee } })).phone).not.toBe("0300");
  });

  it("uses names that company 1 already has (unique per company, not across companies)", async () => {
    const r = await call(departments.POST, { userId: owner, body: { name: "Engineering" } });
    expect(r.status).toBe(200);
    expect(await db.department.count({ where: { name: "Engineering" } })).toBe(2);
  });

  it("company 1 still sees only its own data", async () => {
    const list = await call(employees.GET, { userId: c1.hr });
    expect(JSON.stringify(list.body)).toContain("Ali Raza");
    expect(JSON.stringify(list.body)).not.toContain("Judge");
    const depts = (await call(departments.GET, { userId: c1.admin })).body as { items?: { name: string }[] } | { name: string }[];
    expect(JSON.stringify(depts)).not.toContain("Judge");
  });

  it("the AI assistant's tools answer only from the asker's company", async () => {
    const judge = await sessionFor(db, "judge@judge.test");
    const result = await runInCompany(2, () => runTool(judge, "search_employees", JSON.stringify({ query: "Ali" })));
    expect(JSON.stringify(result)).not.toContain("Ali Raza");
    const headcount = await runInCompany(2, () => runTool(judge, "get_headcount", "{}"));
    expect(headcount.ok).toBe(true);
    expect(JSON.parse((headcount as { content: string }).content)).toMatchObject({ total: 0 });
  });
});
