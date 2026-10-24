import { NextResponse } from "next/server";
import { publicRoute, readJson } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { sessionCookie } from "@/lib/auth";
import { envAdmin, needsSetup, runSetup, setupSchema } from "@/server/services/auth.service";

// GET /api/setup → is this a fresh install?   POST /api/setup → create company + Admin (only once)
export const GET = publicRoute(async () => ({ needsSetup: await needsSetup(), adminFromEnv: !!envAdmin() }));

export const POST = publicRoute(async (req) => {
  if (!(await needsSetup())) throw new HttpError(409, "Setup has already been completed.", "conflict");
  const { token } = await runSetup(await readJson(req, setupSchema));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, req));
  return res;
});
