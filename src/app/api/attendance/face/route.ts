import { readJson, withSession } from "@/lib/api";
import { enrollFace, enrollFaceSchema, getFaceStatus } from "@/server/services/attendance.service";

// GET  /api/attendance/face → is my face enrolled for camera check-in?
// POST /api/attendance/face → enrol my face once: { descriptor: number[128] } (computed in the browser; no photo)
export const GET = withSession(async (_req, s) => getFaceStatus(s), { roles: ["HR", "EMPLOYEE"] });
export const POST = withSession(async (req, s) => enrollFace(s, await readJson(req, enrollFaceSchema)), { roles: ["HR", "EMPLOYEE"] });
