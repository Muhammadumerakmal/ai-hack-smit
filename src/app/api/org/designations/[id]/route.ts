import { readJson, withSession } from "@/lib/api";
import { deleteDesignation, nameSchema, renameDesignation } from "@/server/services/org.service";

// PATCH { name } · DELETE (Admin; only when unused)
export const PATCH = withSession<{ id: string }>(async (req, s, { id }) => renameDesignation(s, id, (await readJson(req, nameSchema)).name), { roles: ["ADMIN"] });
export const DELETE = withSession<{ id: string }>(async (_req, s, { id }) => {
  await deleteDesignation(s, id);
  return { ok: true };
}, { roles: ["ADMIN"] });
