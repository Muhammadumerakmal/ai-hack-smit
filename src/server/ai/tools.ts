import { InvalidToolInputError, tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { badRequest, forbidden, HttpError } from "@/lib/errors";
import type { Role, Session } from "@/lib/session";
import { getAttendanceSummary, getLateComers } from "../services/attendance.service";
import { getHeadcount, searchEmployees } from "../services/employee.service";
import { getLeaveBalance, getLeaveSummary } from "../services/leave.service";
import { getPayrollSummary } from "../services/payroll.service";
import type { AiContext } from "./agents";

// OpenAI Agents SDK function tools. The SDK validates the model's arguments against the zod schema;
// each tool then calls the same service (and the same permission checks) the REST API uses.
// No tool touches the database for data.

const period = {
  start: z.iso.date().optional().describe("Start date YYYY-MM-DD. Defaults to the 1st of the current month."),
  end: z.iso.date().optional().describe("End date YYYY-MM-DD. Defaults to today."),
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
  if (actor.role === "EMPLOYEE") {
    // Models often pass the user's own name ("Sara Ahmed", "sara") or code instead of "me".
    // Accept only an exact match on the caller's own record; anything else is someone else.
    if (actor.employeeId && (await isOwnReference(actor.employeeId, r))) return actor.employeeId;
    throw forbidden("Employees can only see their own data.");
  }
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

async function isOwnReference(employeeId: string, ref: string): Promise<boolean> {
  const me = await db.employee.findUnique({ where: { id: employeeId }, select: { code: true, fullName: true, email: true } });
  if (!me) return false;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const r = norm(ref);
  const name = norm(me.fullName);
  return r === norm(me.code) || r === norm(me.email) || r === name || name.split(" ").includes(r);
}

/** A refusal or error as the model sees it. The `error` field also marks the call as failed in ai_logs. */
export const toolFailure = (error: string, message: string) => JSON.stringify({ error, message });

/** The SDK calls this when arguments fail the zod schema or the service throws. */
function toolError(_ctx: RunContext<AiContext>, err: unknown): string {
  if (err instanceof InvalidToolInputError) return toolFailure("invalid_arguments", "The arguments do not match the tool's parameters.");
  if (err instanceof HttpError) return toolFailure(err.code, err.message);
  console.error("[ai] tool failed", err);
  return toolFailure("internal", "The data could not be loaded right now.");
}

/** Role scoping: a tool is only offered to the model when the signed-in role may call it. */
const forRoles =
  (...roles: Role[]) =>
  ({ runContext }: { runContext: RunContext<AiContext> }) =>
    roles.includes(runContext.context.actor.role);

function actorOf(runContext?: RunContext<AiContext>): Session {
  if (!runContext) throw forbidden();
  return runContext.context.actor;
}

const common = { errorFunction: toolError } as const;

export const TOOLS = [
  tool({
    ...common,
    name: "get_headcount",
    description:
      "Number of active + probation employees on a date: the total AND a per-department breakdown. Omit `department` to get every department in one call.",
    isEnabled: forRoles("ADMIN", "HR"),
    parameters: z.object({ department, asOf: z.iso.date().optional().describe("Date YYYY-MM-DD, default today.") }),
    execute: async (a, rc?: RunContext<AiContext>) => JSON.stringify(await getHeadcount(actorOf(rc), a)),
  }),
  tool({
    ...common,
    name: "get_attendance_summary",
    description:
      "Attendance counts (present, late, half day, missing checkout, absent, on leave) and attendance rate, late % and absenteeism % for a period. For employees this is always their own attendance.",
    isEnabled: forRoles("ADMIN", "HR", "EMPLOYEE"),
    parameters: z.object({ ...period, department, employee }),
    execute: async (a, rc?: RunContext<AiContext>) => {
      const actor = actorOf(rc);
      return JSON.stringify(
        await getAttendanceSummary(actor, { ...defaultPeriod(a), department: a.department, employeeId: await resolveEmployeeRef(actor, a.employee) }),
      );
    },
  }),
  tool({
    ...common,
    name: "get_late_comers",
    description: "Employees ranked by how many days they checked in late in a period.",
    isEnabled: forRoles("ADMIN", "HR"),
    parameters: z.object({ ...period, department, limit: z.number().int().min(1).max(20).optional() }),
    execute: async (a, rc?: RunContext<AiContext>) =>
      JSON.stringify(await getLateComers(actorOf(rc), { ...defaultPeriod(a), department: a.department, limit: a.limit })),
  }),
  tool({
    ...common,
    name: "get_leave_summary",
    description:
      "Approved leave days by type and department in a period, pending leave requests, and who is on leave today. For employees this is only their own leave.",
    isEnabled: forRoles("ADMIN", "HR", "EMPLOYEE"),
    parameters: z.object({ ...period, department, employee }),
    execute: async (a, rc?: RunContext<AiContext>) => {
      const actor = actorOf(rc);
      return JSON.stringify(
        await getLeaveSummary(actor, { ...defaultPeriod(a), department: a.department, employeeId: await resolveEmployeeRef(actor, a.employee) }),
      );
    },
  }),
  tool({
    ...common,
    name: "get_my_leave_balance",
    description:
      "Leave balance per leave type for a year: quota, approved days used, pending days and remaining. Defaults to the signed-in user. Admin/HR may pass another employee.",
    isEnabled: forRoles("ADMIN", "HR", "EMPLOYEE"),
    parameters: z.object({ year: z.number().int().min(2000).max(2100).optional(), employee }),
    execute: async (a, rc?: RunContext<AiContext>) => {
      const actor = actorOf(rc);
      return JSON.stringify(await getLeaveBalance(actor, { year: a.year, employeeId: await resolveEmployeeRef(actor, a.employee) }));
    },
  }),
  tool({
    ...common,
    name: "get_payroll_summary",
    description:
      "Admin/HR: payroll totals (gross, net, tax, deductions, average gross, by department) for a month. Employee: only their own finalized payslip.",
    isEnabled: forRoles("ADMIN", "HR", "EMPLOYEE"),
    parameters: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Month YYYY-MM, default latest run."), department }),
    execute: async (a, rc?: RunContext<AiContext>) => JSON.stringify(await getPayrollSummary(actorOf(rc), a)),
  }),
  tool({
    ...common,
    name: "search_employees",
    description: "Find employees by name, code or email, optionally by department or status. Returns directory details.",
    isEnabled: forRoles("ADMIN", "HR"),
    parameters: z.object({
      query: z.string().max(80).optional(),
      department,
      status: z.enum(["ACTIVE", "PROBATION", "INACTIVE", "EXITED"]).optional(),
    }),
    execute: async (a, rc?: RunContext<AiContext>) => JSON.stringify(await searchEmployees(actorOf(rc), a)),
  }),
];
