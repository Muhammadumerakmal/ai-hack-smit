import { readJson, withSession } from "@/lib/api";
import { deleteDepartment, nameSchema, renameDepartment } from "@/server/services/org.service";

// PATCH { name } · DELETE (Admin; only when no employees are in it)
export const PATCH = withSession<{ id: string }>(async (req, s, { id }) => renameDepartment(s, id, (await readJson(req, nameSchema)).name), { roles: ["ADMIN"] });
export const DELETE = withSession<{ id: string }>(async (_req, s, { id }) => {
  await deleteDepartment(s, id);
  return { ok: true };
}, { roles: ["ADMIN"] });
