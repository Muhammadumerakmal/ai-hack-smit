import { withSession } from "@/lib/api";
import { resetFace } from "@/server/services/attendance.service";

// DELETE /api/employees/:id/face → HR removes an employee's enrolled face so they can enrol again.
export const DELETE = withSession<{ id: string }>(async (_req, s, p) => resetFace(s, p.id), { roles: ["HR"] });
