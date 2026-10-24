import { readJson, searchParams, withSession, yearParam } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { createHoliday, holidaySchema, listHolidays } from "@/server/services/org.service";

// GET ?year= (any signed-in role) · POST { date, name } (Admin)
export const GET = withSession(async (req) => {
  const year = yearParam(searchParams(req).get("year")) ?? Number(todayIso().slice(0, 4));
  return { year, items: await listHolidays(year) };
});
export const POST = withSession(async (req, s) => createHoliday(s, await readJson(req, holidaySchema)), { roles: ["ADMIN"] });
