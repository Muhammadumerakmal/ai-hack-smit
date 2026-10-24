import { readJson, withSession } from "@/lib/api";
import { createHrSchema, createHrUser, listUsers } from "@/server/services/auth.service";

// Admin only (#05): list logins, create HR logins
export const GET = withSession(async (_req, s) => ({ items: await listUsers(s) }), { roles: ["ADMIN"] });
export const POST = withSession(async (req, s) => createHrUser(s, await readJson(req, createHrSchema)), { roles: ["ADMIN"] });
