import { searchParams, withSession } from "@/lib/api";
import { getDashboard, parseDashboardFilters } from "@/server/services/analytics.service";

// GET /api/dashboard?start=&end=&department=
// Admin / HR → company KPIs, trend and chart data for the filters. Employee → personal dashboard only.
export const GET = withSession(async (req, s) => getDashboard(s, parseDashboardFilters(searchParams(req))));
