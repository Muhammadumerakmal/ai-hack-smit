import { readJson, withSession } from "@/lib/api";
import { checkIn, checkInSchema } from "@/server/services/attendance.service";

// POST /api/attendance/check-in → the server stamps the time. Second check-in the same day = 409.
// Body (optional): {} or { method: "web" } for the web button; { method: "camera", lat, lng, accuracy, faces, liveness }
// for camera check-in, where the server checks the face count, blink, GPS accuracy and distance to the office.
export const POST = withSession(
  async (req, s) => ({ ok: true, record: await checkIn(s, new Date(), await readJson(req, checkInSchema, { method: "web" })) }),
  { roles: ["HR", "EMPLOYEE"] },
);
