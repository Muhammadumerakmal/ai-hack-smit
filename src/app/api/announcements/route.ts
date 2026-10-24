import { readJson, searchParams, withSession } from "@/lib/api";
import { announcementSchema, listAnnouncements, postAnnouncement } from "@/server/services/comms.service";

// GET /api/announcements?limit= (everyone)   POST /api/announcements { title, body } (Admin, HR)
export const GET = withSession(async (req) => ({ items: await listAnnouncements(Number(searchParams(req).get("limit") ?? 20) || 20) }));

export const POST = withSession(async (req, s) => postAnnouncement(s, await readJson(req, announcementSchema)), { roles: ["ADMIN", "HR"] });
