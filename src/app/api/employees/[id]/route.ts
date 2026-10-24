import { readJson, withSession } from "@/lib/api";
import { z } from "zod";
import { getEmployee360, updateEmployee } from "@/server/services/people.service";

// GET /api/employees/:id → Employee 360 (Admin/HR any; Employee own only)
export const GET = withSession<{ id: string }>(async (_req, s, { id }) => getEmployee360(s, id));

// PATCH /api/employees/:id  (HR: details, salary, status, exit date; Employee: own phone & address only)
export const PATCH = withSession<{ id: string }>(async (req, s, { id }) => updateEmployee(s, id, await readJson(req, z.record(z.string(), z.unknown()))));
