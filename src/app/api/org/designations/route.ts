import { readJson, withSession } from "@/lib/api";
import { createDesignation, listDesignations, nameSchema } from "@/server/services/org.service";

// GET (any signed-in role) · POST { name } (Admin)
export const GET = withSession(async () => ({ items: await listDesignations() }));
export const POST = withSession(async (req, s) => createDesignation(s, (await readJson(req, nameSchema)).name), { roles: ["ADMIN"] });
