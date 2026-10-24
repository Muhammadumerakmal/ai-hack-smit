import { withSession } from "@/lib/api";
import { resetPassword } from "@/server/services/auth.service";

// POST /api/users/:id/reset-password → new temporary password, shown once
export const POST = withSession<{ id: string }>(async (_req, s, { id }) => resetPassword(s, id), { roles: ["ADMIN"] });
