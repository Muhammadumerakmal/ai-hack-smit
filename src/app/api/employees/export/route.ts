import { withSession } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { exportEmployeesCsv } from "@/server/services/people.service";

// GET /api/employees/export  (HR) → CSV download, same columns the import accepts
export const GET = withSession(
  async (_req, s) =>
    new Response(await exportEmployeesCsv(s), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="employees-${todayIso()}.csv"`,
        "cache-control": "no-store",
      },
    }),
  { roles: ["HR"] },
);
