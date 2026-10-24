import { withSession } from "@/lib/api";
import { finalizeRun } from "@/server/services/payroll.service";

// POST /api/payroll/runs/:month/finalize (Admin only) → locks the month, notifies employees
export const POST = withSession<{ month: string }>(async (_req, s, { month }) => finalizeRun(s, month), { roles: ["ADMIN"] });
