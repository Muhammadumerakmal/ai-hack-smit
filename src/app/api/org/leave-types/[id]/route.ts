import { readJson, withSession } from "@/lib/api";
import { leaveTypeSchema, upsertLeaveType } from "@/server/services/org.service";

// PATCH (Admin) — full leave type body
export const PATCH = withSession<{ id: string }>(async (req, s, { id }) => upsertLeaveType(s, await readJson(req, leaveTypeSchema), id), { roles: ["ADMIN"] });
