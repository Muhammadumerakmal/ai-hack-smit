import { readJson, withSession } from "@/lib/api";
import { createDepartment, listDepartments, nameSchema } from "@/server/services/org.service";

// GET (any signed-in role, for forms and filters) · POST (Admin)
export const GET = withSession(async () => ({ items: await listDepartments() }));
export const POST = withSession(async (req, s) => createDepartment(s, (await readJson(req, nameSchema)).name), { roles: ["ADMIN"] });
