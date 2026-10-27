import { PrismaClient } from "@prisma/client";
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFebCompany, FEB, febWorkingDays } from "./biz-fixtures";
import { hasDb } from "./helpers";

// QA-3 performance: the services use a Prisma client that counts every SQL query, so N+1 patterns
// (query count growing with the number of employees) show up as a failing assertion.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: PC } = await import("@prisma/client");
  const counted = new PC({ log: [{ emit: "event", level: "query" }] });
  let n = 0;
  (counted as unknown as { $on: (e: string, cb: () => void) => void }).$on("query", () => {
    n++;
  });
  return { db: counted, __queries: { reset: () => (n = 0), count: () => n } };
});

const { getDashboard } = await import("@/server/services/analytics.service");
const { computeMonth } = await import("@/server/services/payroll.service");
const { getDayRows } = await import("@/server/services/attendance.service");
const { importEmployeesCsv, listEmployees } = await import("@/server/services/people.service");
const q = ((await import("@/lib/db")) as unknown as { __queries: { reset: () => void; count: () => number } }).__queries;

const REPORT = process.env.QA3_REPORT;
const log = (line: string) => REPORT && appendFileSync(REPORT, line + "\n");

describe.skipIf(!hasDb)("QA-3 performance: query counts do not grow with employees", () => {
  const db = new PrismaClient();
  let fx: Awaited<ReturnType<typeof buildFebCompany>>;

  const addEmployees = async (from: number, to: number) => {
    const days = febWorkingDays();
    const emps = Array.from({ length: to - from }, (_, i) => {
      const k = from + i;
      return {
        code: `P${String(k).padStart(4, "0")}`,
        fullName: `Perf Person ${k}`,
        email: `perf${k}@qa.test`,
        departmentId: k % 2 ? fx.depts.eng.id : fx.depts.sales.id,
        joinDate: new Date("2025-01-01T00:00:00Z"),
        status: "ACTIVE" as const,
        basicSalary: 50_000 + k,
      };
    });
    await db.employee.createMany({ data: emps.map((e) => ({ companyId: 1, ...e })) });
    const ids = await db.employee.findMany({ where: { code: { in: emps.map((e) => e.code) } }, select: { id: true } });
    await db.attendance.createMany({
      data: ids.flatMap((e, i) =>
        days.map((d) => ({
          companyId: 1,
          employeeId: e.id,
          date: new Date(`${d}T00:00:00Z`),
          checkIn: new Date(`${d}T${i % 7 === 0 ? "04:40" : "04:00"}:00Z`),
          checkOut: new Date(`${d}T12:00:00Z`),
          status: i % 7 === 0 ? ("LATE" as const) : ("PRESENT" as const),
        })),
      ),
    });
  };

  const measure = async <T,>(label: string, fn: () => Promise<T>) => {
    q.reset();
    const t = performance.now();
    const out = await fn();
    const ms = Math.round(performance.now() - t);
    return { label, queries: q.count(), ms, out };
  };

  beforeAll(async () => {
    fx = await buildFebCompany(db);
    await addEmployees(0, 10);
  }, 120_000);
  afterAll(() => db.$disconnect());

  it("dashboard, payroll computeMonth and getDayRows: same query count at 14 and 314 employees", async () => {
    const small = {
      dash: await measure("dashboard(admin)", () => getDashboard(fx.admin, FEB)),
      hr: await measure("dashboard(hr)", () => getDashboard(fx.hr, FEB)),
      pay: await measure("computeMonth", () => computeMonth(FEB.month)),
      rows: await measure("getDayRows", () => getDayRows(FEB)),
    };
    await addEmployees(10, 310);
    const big = {
      dash: await measure("dashboard(admin)", () => getDashboard(fx.admin, FEB)),
      hr: await measure("dashboard(hr)", () => getDashboard(fx.hr, FEB)),
      pay: await measure("computeMonth", () => computeMonth(FEB.month)),
      rows: await measure("getDayRows", () => getDayRows(FEB)),
    };
    for (const k of ["dash", "hr", "pay", "rows"] as const) {
      log(`${big[k].label}: queries ${small[k].queries} @14 emp → ${big[k].queries} @314 emp; time ${small[k].ms} ms → ${big[k].ms} ms`);
      expect(big[k].queries, big[k].label).toBe(small[k].queries);
    }
    expect((big.pay.out as Awaited<ReturnType<typeof computeMonth>>).slips).toHaveLength(314); // 310 + A, B, C, E
    expect((await getDayRows(FEB)).length).toBe(56 + 310 * 19);
  }, 120_000);

  it("employee list: server-side paging is complete, ordered and duplicate-free; search works", async () => {
    const total = await db.employee.count();
    const seen: string[] = [];
    let page = 1;
    for (;;) {
      const r = await listEmployees(fx.hr, { page, pageSize: 50 });
      expect(r.total).toBe(total);
      if (!r.items.length) break;
      seen.push(...r.items.map((i) => i.code));
      page++;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect([...seen].sort()).toEqual(seen); // ordered by code
    const m = await measure("listEmployees page", () => listEmployees(fx.hr, { page: 3, pageSize: 50 }));
    log(`listEmployees(page 3 of ${total}): ${m.queries} queries, ${m.ms} ms`);
    expect(m.queries).toBeLessThanOrEqual(6);

    expect((await listEmployees(fx.hr, { search: "Perf Person 123" })).items.map((i) => i.code)).toEqual(["P0123"]);
    expect((await listEmployees(fx.hr, { search: "p0042" })).total).toBe(1); // code, case-insensitive
    expect((await listEmployees(fx.hr, { search: "perf77@qa.test" })).total).toBe(1);
    const none = await listEmployees(fx.hr, { search: "no such person" });
    expect(none).toMatchObject({ total: 0, items: [] });
    expect((await listEmployees(fx.hr, { page: 999, pageSize: 50 })).items).toEqual([]);
  }, 120_000);

  it("CSV import of 200 rows: dry run and real import finish well inside the 60 s transaction limit", async () => {
    const lines = ["code,full_name,email,department,join_date,basic_salary"];
    for (let i = 0; i < 200; i++) lines.push(`CSV${i},Csv Person ${i},csv${i}@qa.test,${i % 2 ? "Engineering" : "Sales"},2026-10-01,${40000 + i}`);
    const csv = lines.join("\n");
    const dry = await measure("csv dry run", () => importEmployeesCsv(fx.hr, csv, true));
    expect(dry.out).toMatchObject({ dryRun: true, valid: 200, errors: [] });
    const real = await measure("csv import", () => importEmployeesCsv(fx.hr, csv, false));
    expect(real.out).toMatchObject({ dryRun: false, valid: 200 });
    expect(await db.user.count({ where: { email: { startsWith: "csv" } } })).toBe(200);
    log(`csv 200 rows: dry run ${dry.queries} queries ${dry.ms} ms; import ${real.queries} queries ${real.ms} ms`);
    expect(dry.queries).toBeLessThanOrEqual(6);
    expect(real.ms).toBeLessThan(45_000);
  }, 120_000);
});
