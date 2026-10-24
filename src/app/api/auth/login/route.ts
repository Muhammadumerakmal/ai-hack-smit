import { NextResponse } from "next/server";
import { publicRoute, readJson } from "@/lib/api";
import { sessionCookie } from "@/lib/auth";
import { login, loginSchema } from "@/server/services/auth.service";

// POST /api/auth/login { email, password } → sets the httpOnly JWT cookie.
// The token is deliberately NOT in the JSON body: script on the page could read a body, but not an httpOnly cookie.
export const POST = publicRoute(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  const { token, mustChangePassword } = await login(email, password);
  const res = NextResponse.json({ ok: true, mustChangePassword });
  res.cookies.set(sessionCookie(token, req));
  return res;
});
