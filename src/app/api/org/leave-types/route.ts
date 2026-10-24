import { readJson, withSession } from "@/lib/api";
import { leaveTypeSchema, listLeaveTypes, upsertLeaveType } from "@/server/services/org.service";

// GET (any signed-in role) · POST { code, name, yearlyQuota (null = unlimited), isPaid } (Admin)
export const GET = withSession(async () => ({ items: await listLeaveTypes() }));
export const POST = withSession(async (req, s) => upsertLeaveType(s, await readJson(req, leaveTypeSchema)), { roles: ["ADMIN"] });
