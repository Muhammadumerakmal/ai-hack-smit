import { readJson, searchParams, withSession } from "@/lib/api";
import { correctionSchema, listCorrections, requestCorrection } from "@/server/services/attendance.service";

// GET  /api/attendance/corrections?status=   (employee: own; HR/Admin: all)
// POST /api/attendance/corrections { date, checkIn: "HH:MM", checkOut?, reason }   (request for own attendance)
export const GET = withSession(async (req, s) => listCorrections(s, { status: searchParams(req).get("status") || undefined }));

export const POST = withSession(async (req, s) => ({ ok: true, correction: await requestCorrection(s, await readJson(req, correctionSchema)) }), {
  roles: ["HR", "EMPLOYEE"],
});
