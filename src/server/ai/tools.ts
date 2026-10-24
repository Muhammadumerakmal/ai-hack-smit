import { z } from "zod";
import { db } from "@/lib/db";
import { isIsoDate, todayIso } from "@/lib/dates";
import { badRequest, forbidden, HttpError } from "@/lib/errors";
import type { Role, Session } from "@/lib/session";
import { getAttendanceSummary, getLateComers } from "../services/attendance.service";
import { getHeadcount, searchEmployees } from "../services/employee.service";
import { getLeaveBalance, getLeaveSummary } from "../services/leave.service";
import { getPayrollSummary } from "../services/payroll.service";
import type { ToolDef } from "./llm";

// Each tool is a thin adapter: validate the model's arguments, then call the same service
// (and the same permission checks) the REST API uses. No tool touches the database for data.

const isoDate = z.string().refine(isIsoDate, "must be a date in YYYY-MM-DD format");
const period = {
  start: isoDate.optional().describe("Start date YYYY-MM-DD. Defaults to the 1st of the current month."),
  end: isoDate.optional().describe("End date YYYY-MM-DD. Defaults to today."),
};
const department = z.string().max(80).optional().describe("Department name, e.g. 'Engineering'. Omit for all departments.");
const employee = z
  .string()
  .max(80)
  .optional()
  .describe("'me' for the signed-in user, or another employee's code or name (Admin/HR only). Omit for everyone in scope.");

function defaultPeriod(args: { start?: string; end?: string }) {
  const today = todayIso();
  return { start: args.start ?? `${today.slice(0, 7)}-01`, end: args.end ?? today };
}

/** "me" → own id; a code or name → id (Admin/HR only). Employees asking about anyone else get a 403. */
export async function resolveEmployeeRef(actor: Session, ref?: string): Promise<string | undefined> {
  if (!ref) return undefined;
  const r = ref.trim();
  if (/^(me|my|myself|self|mine)$/i.test(r)) {
    if (!actor.employeeId) throw badRequest("Your login is not linked to an employee record.");
    return actor.employeeId;
  }
  if (actor.role === "EMPLOYEE") throw forbidden("Employees can only see their own data.");
  const matches = await db.employee.findMany({
    where: { OR: [{ code: { equals: r, mode: "insensitive" } }, { fullName: { contains: r, mode: "insensitive" } }] },
    select: { id: true, code: true, fullName: true },
    take: 5,
  });
  if (matches.length === 0) throw new HttpError(404, `No employee matches "${r}".`, "not_found");
  if (matches.length > 1) {
    throw badRequest(`"${r}" matches several employees: ${matches.map((m) => `${m.fullName} (${m.code})`).join(", ")}. Ask which one.`);
  }
  return matches[0].id;
}

interface AiTool<S extends z.ZodObject> {
  name: string;
  description: string;
  roles: Role[];
  input: S;
  run: (actor: Session, args: z.infer<S>) => Promise<unknown>;
}

const tool = <S extends z.ZodObject>(t: AiTool<S>) => t;

export const TOOLS = [
  tool({
    name: "get_headcount",
    description: "Number of active + probation employees on a date, in total and per department.",
    roles: ["ADMIN", "HR"],
    input: z.object({ department, asOf: isoDate.optional().describe("Date YYYY-MM-DD, default today.") }),
    run: (actor, a) => getHeadcount(actor, a),
  }),
  tool({
    name: "get_attendance_summary",
    description:
      "Attendance counts (present, late, half day, missing checkout, absent, on leave) and attendance rate, late % and absenteeism % for a period. For employees this is always their own attendance.",
    roles: ["ADMIN", "HR", "EMPLOYEE"],
    input: z.object({ ...period, department, employee }),
    run: async (actor, a) =>
      getAttendanceSummary(actor, { ...defaultPeriod(a), department: a.department, employeeId: await resolveEmployeeRef(actor, a.employee) }),
  }),
  tool({
    name: "get_late_comers",
    description: "Employees ranked by how many days they checked in late in a period.",
    roles: ["ADMIN", "HR"],
    input: z.object({ ...period, department, limit: z.number().int().min(1).max(20).optional() }),
    run: (actor, a) => getLateComers(actor, { ...defaultPeriod(a), department: a.department, limit: a.limit }),
  }),
  tool({
    name: "get_leave_summary",
    description:
      "Approved leave days by type and department in a period, pending leave requests, and who is on leave today. For employees this is only their own leave.",
    roles: ["ADMIN", "HR", "EMPLOYEE"],
    input: z.object({ ...period, department, employee }),
    run: async (actor, a) =>
      getLeaveSummary(actor, { ...defaultPeriod(a), department: a.department, employeeId: await resolveEmployeeRef(actor, a.employee) }),
  }),
  tool({
    name: "get_my_leave_balance",
    description:
      "Leave balance per leave type for a year: quota, approved days used, pending days and remaining. Defaults to the signed-in user. Admin/HR may pass another employee.",
    roles: ["ADMIN", "HR", "EMPLOYEE"],
    input: z.object({ year: z.number().int().min(2000).max(2100).optional(), employee }),
    run: async (actor, a) => getLeaveBalance(actor, { year: a.year, employeeId: await resolveEmployeeRef(actor, a.employee) }),
  }),
  tool({
    name: "get_payroll_summary",
    description:
      "Admin/HR: payroll totals (gross, net, tax, deductions, average gross, by department) for a month. Employee: only their own finalized payslip.",
    roles: ["ADMIN", "HR", "EMPLOYEE"],
    input: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Month YYYY-MM, default latest run."), department }),
    run: (actor, a) => getPayrollSummary(actor, a),
  }),
  tool({
    name: "search_employees",
    description: "Find employees by name, code or email, optionally by department or status. Returns directory details.",
    roles: ["ADMIN", "HR"],
    input: z.object({
      query: z.string().max(80).optional(),
      department,
      status: z.enum(["ACTIVE", "PROBATION", "INACTIVE", "EXITED"]).optional(),
    }),
    run: (actor, a) => searchEmployees(actor, a),
  }),
];

/** The tool list sent to the model: only what this role is allowed to call. */
export function toolDefsFor(role: Role): ToolDef[] {
  return TOOLS.filter((t) => t.roles.includes(role)).map((t) => {
    const parameters = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete parameters.$schema;
    return { name: t.name, description: t.description, parameters };
  });
}

export interface ToolResult {
  ok: boolean;
  content: string;
}

/**
 * Run a tool call from the model. The role check is repeated here (not only in the tool list)
 * so a model that invents a call to a tool it was not given still gets a refusal.
 */
export async function runTool(actor: Session, name: string, rawArgs: string): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t || !t.roles.includes(actor.role)) {
    return fail("forbidden", "This information is not available to your role.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return fail("invalid_arguments", "Arguments were not valid JSON.");
  }
  const parsed = t.input.safeParse(parsedJson);
  if (!parsed.success) return fail("invalid_arguments", z.prettifyError(parsed.error));

  try {
    // The union of tool types loses the per-tool link between input and run; parsed.data came from t.input.
    const data = await (t.run as (a: Session, b: unknown) => Promise<unknown>)(actor, parsed.data);
    return { ok: true, content: JSON.stringify(data) };
  } catch (err) {
    if (err instanceof HttpError) return fail(err.code, err.message);
    console.error(`[ai] tool ${name} failed`, err);
    return fail("internal", "The data could not be loaded right now.");
  }
}

function fail(error: string, message: string): ToolResult {
  return { ok: false, content: JSON.stringify({ error, message }) };
}
