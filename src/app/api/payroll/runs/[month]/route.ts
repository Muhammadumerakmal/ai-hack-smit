import { withSession } from "@/lib/api";
import { getRun } from "@/server/services/payroll.service";

// GET /api/payroll/runs/:month → run + payslips (Admin, HR)
export const GET = withSession<{ month: string }>(async (_req, s, { month }) => getRun(s, month), { roles: ["ADMIN", "HR"] });
