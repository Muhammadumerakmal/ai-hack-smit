import { z } from "zod";
import { readJson, withSession } from "@/lib/api";
import { importEmployeesCsv } from "@/server/services/people.service";

const schema = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(true) });

// POST /api/employees/import { csv, dryRun }  (HR) → dry run lists every problem as row + field + reason
export const POST = withSession(
  async (req, s) => {
    const { csv, dryRun } = await readJson(req, schema);
    return importEmployeesCsv(s, csv, dryRun);
  },
  { roles: ["HR"] },
);
