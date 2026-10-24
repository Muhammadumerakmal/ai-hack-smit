import { readJson, searchParams, withSession } from "@/lib/api";
import { createEmployee, employeeSchema, listEmployees } from "@/server/services/people.service";

// GET /api/employees?search=&departmentId=&status=&page=&pageSize=  (Admin/HR all; Employee: own row only)
export const GET = withSession(async (req, s) => {
  const p = searchParams(req);
  return listEmployees(s, {
    search: p.get("search") ?? undefined,
    departmentId: p.get("departmentId") ?? undefined,
    status: p.get("status") ?? undefined,
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("pageSize")) || 20,
  });
});

// POST /api/employees  (HR) → creates the employee and their login; returns the temporary password once
export const POST = withSession(async (req, s) => createEmployee(s, await readJson(req, employeeSchema)), { roles: ["HR"] });
