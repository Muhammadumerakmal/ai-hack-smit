import { readJson, withSession } from "@/lib/api";
import { getCompanySettings, settingsSchema, updateCompanySettings } from "@/server/services/org.service";

// GET /api/org/settings (Admin, HR view) · PUT (Admin) — applied to new records only
export const GET = withSession(async (_req, s) => getCompanySettings(s), { roles: ["ADMIN", "HR"] });
export const PUT = withSession(async (req, s) => updateCompanySettings(s, await readJson(req, settingsSchema)), { roles: ["ADMIN"] });
