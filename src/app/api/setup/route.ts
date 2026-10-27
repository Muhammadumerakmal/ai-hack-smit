import { NextResponse } from "next/server";
import { publicRoute, readJson } from "@/lib/api";
import { sessionCookie } from "@/lib/auth";
import { envAdmin, needsSetup, runSetup, setupSchema } from "@/server/services/auth.service";

// GET /api/setup  → { needsSetup } (true only on a brand-new install) and whether ADMIN_EMAIL/ADMIN_PASSWORD can be used
// POST /api/setup → create a company with its Admin account and sign in as that Admin. Open to any visitor:
//                   each company is separate, so this never gives access to an existing company.
export const GET = publicRoute(async () => {
  const fresh = await needsSetup();
  return { needsSetup: fresh, adminFromEnv: fresh && !!envAdmin() };
});

export const POST = publicRoute(async (req) => {
  const clientKey = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const { token } = await runSetup(await readJson(req, setupSchema), clientKey);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, req));
  return res;
});
