import { readJson, withSession } from "@/lib/api";
import { changePassword, changePasswordSchema } from "@/server/services/auth.service";

// POST /api/auth/change-password { currentPassword, newPassword }
export const POST = withSession(
  async (req, s) => {
    const { currentPassword, newPassword } = await readJson(req, changePasswordSchema);
    await changePassword(s, currentPassword, newPassword);
    return { ok: true };
  },
  { allowPasswordChange: true },
);
