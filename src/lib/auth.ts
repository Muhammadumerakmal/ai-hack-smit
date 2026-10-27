import { jwtVerify, SignJWT } from "jose";
import { db } from "./db";
import { unauthorized } from "./errors";
import { runAsSystem } from "./tenant";
import type { Session } from "./session";

export const SESSION_COOKIE = "token";
const TOKEN_TTL = "8h";

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

/** The JWT only identifies the user. Role, scope and active state are read fresh from the DB on every request. */
export async function signToken(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(TOKEN_TTL).sign(secret());
}

/** Returns the user id, or null for a missing, expired or tampered token. */
export async function verifyToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export interface AuthContext extends Session {
  email: string;
  mustChangePassword: boolean;
}

export async function loadSession(userId: string): Promise<AuthContext | null> {
  // Before this lookup the company is not known yet, so it runs unscoped; the user row says which company it is.
  const user = await runAsSystem(() =>
    db.user.findUnique({ where: { id: userId }, include: { employee: { select: { id: true, fullName: true } } } }),
  );
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    employeeId: user.employee?.id ?? null,
    name: user.employee?.fullName || user.name || user.email,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
  };
}

export function readToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getSession(req: Request): Promise<AuthContext> {
  const userId = await verifyToken(readToken(req));
  const session = userId ? await loadSession(userId) : null;
  if (!session) throw unauthorized("Please sign in again.");
  return session;
}

/** Secure whenever the request came over https (hosting proxies set x-forwarded-proto). */
export const sessionCookie = (token: string, req: Request) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https",
  path: "/",
  maxAge: 8 * 60 * 60,
});
