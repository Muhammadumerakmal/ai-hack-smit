import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, type AuthContext } from "./auth";
import { HttpError } from "./errors";
import { assertRole, type Role } from "./session";

type Params = Record<string, string>;

interface RouteOptions {
  /** Roles allowed to call this route at all (services still check data scope). */
  roles?: Role[];
  /** Routes a user with a temporary password may still call. */
  allowPasswordChange?: boolean;
}

/**
 * Route wrapper: session → role guard → handler → JSON.
 * HttpErrors and validation errors become proper status codes; a handler may also return its own Response.
 */
export function withSession<P extends Params = Params>(
  handler: (req: Request, session: AuthContext, params: P) => Promise<unknown>,
  opts: RouteOptions = {},
) {
  return async (req: Request, ctx?: { params: Promise<P> }) => {
    try {
      const session = await getSession(req);
      if (session.mustChangePassword && !opts.allowPasswordChange) {
        throw new HttpError(403, "Please change your temporary password first.", "password_change_required");
      }
      if (opts.roles) assertRole(session, ...opts.roles);
      const result = await handler(req, session, ((await ctx?.params) ?? {}) as P);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** For the few public routes (login, first-run setup). */
export function publicRoute(handler: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      const result = await handler(req);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ ok: false, error: err.code, message: err.message }, { status: err.status });
  if (err instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: "bad_request", message: z.prettifyError(err) }, { status: 400 });
  }
  if (isUniqueViolation(err)) {
    return NextResponse.json({ ok: false, error: "conflict", message: "That value is already in use." }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json({ ok: false, error: "internal", message: "Something went wrong." }, { status: 500 });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON", "bad_request");
  }
  return schema.parse(body);
}

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}
