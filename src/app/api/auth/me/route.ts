import { withSession } from "@/lib/api";
import { getSettings } from "@/server/services/settings.service";

// GET /api/auth/me → who is signed in (role, employee link) + company name for the shell
export const GET = withSession(
  async (_req, s) => ({
    userId: s.userId,
    name: s.name,
    email: s.email,
    role: s.role,
    employeeId: s.employeeId,
    mustChangePassword: s.mustChangePassword,
    companyName: (await getSettings()).companyName,
  }),
  { allowPasswordChange: true },
);
