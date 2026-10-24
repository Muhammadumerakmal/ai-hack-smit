import { z } from "zod";
import { readJson, withSession } from "@/lib/api";
import { createOrRecomputeDraft, listRuns } from "@/server/services/payroll.service";

// GET  /api/payroll/runs                     (Admin, HR) list of monthly runs
// POST /api/payroll/runs { month: "YYYY-MM" } (HR) create or recompute the draft; finalized months → 409
export const GET = withSession(async (_req, s) => ({ items: await listRuns(s) }), { roles: ["ADMIN", "HR"] });

export const POST = withSession(
  async (req, s) => {
    const { month } = await readJson(req, z.object({ month: z.string() }));
    return createOrRecomputeDraft(s, month);
  },
  { roles: ["HR"] },
);
