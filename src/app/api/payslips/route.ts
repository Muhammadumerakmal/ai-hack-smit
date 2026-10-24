import { searchParams, withSession } from "@/lib/api";
import { listPayslips } from "@/server/services/payroll.service";

// GET /api/payslips?month=YYYY-MM  (Employee: own finalized only; Admin/HR: all)
export const GET = withSession(async (req, s) => ({ items: await listPayslips(s, { month: searchParams(req).get("month") || undefined }) }));
