import { readJson, withSession } from "@/lib/api";
import { updateUser, updateUserSchema } from "@/server/services/auth.service";

// PATCH /api/users/:id { isActive?, role? }  (Admin: deactivate / reactivate / HR⇄Employee)
export const PATCH = withSession<{ id: string }>(
  async (req, s, { id }) => updateUser(s, id, await readJson(req, updateUserSchema)),
  { roles: ["ADMIN"] },
);
