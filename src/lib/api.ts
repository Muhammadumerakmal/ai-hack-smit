import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, type AuthContext } from "./auth";
import { HttpError } from "./errors";
import { assertRole, type Role } from "./session";
import { runAsSystem, runInCompany } from "./tenant";

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
      const params = ((await ctx?.params) ?? {}) as P;
      // Everything the handler does (services, AI tools, PDFs) sees only the user's own company.
      const result = await runInCompany(session.companyId, () => handler(req, session, params));
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** For the few public routes (login, creating a company). They run before a company is known, so unscoped. */
export function publicRoute(handler: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      const result = await runAsSystem(() => handler(req));
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ ok: false, error: err.code, message: err.message }, { status: err.status });
  if (err instanceof z.ZodError) {
    // `fields` lets a form show each problem under its own input; `message` is the same in plain words
    // ("Admin password: Password needs a number.") for forms that only show one summary line.
    const fields = fieldErrors(err);
    const summary = Object.entries(fields).map(([key, msg]) => `${fieldLabel(key)}: ${msg.replace(/\.?$/, ".")}`).join(" ");
    return NextResponse.json({ ok: false, error: "bad_request", message: summary || z.prettifyError(err), fields }, { status: 400 });
  }
  // Known Prisma request errors map to client errors with a generic message (never Prisma's own text).
  switch (prismaCode(err)) {
    case "P2002": // unique constraint (duplicate email/code, second check-in of the day, concurrent create…)
      return NextResponse.json({ ok: false, error: "conflict", message: "That value is already in use." }, { status: 409 });
    case "P2025": // update/delete/findUniqueOrThrow on a record that does not exist
      return NextResponse.json({ ok: false, error: "not_found", message: "Not found." }, { status: 404 });
    case "P2003": // foreign key: the record is still referenced, or points at something missing
      return NextResponse.json({ ok: false, error: "conflict", message: "This record is linked to other data." }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json({ ok: false, error: "internal", message: "Something went wrong." }, { status: 500 });
}

/** First problem per field, in plain words: { "companyName": "Use at least 2 characters." }. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = fieldMessage(issue);
  }
  return out;
}

/** "adminPassword" → "Admin password", "items.0.name" → "Name". */
function fieldLabel(key: string): string {
  const last = key.split(".").filter((p) => !/^\d+$/.test(p)).pop() ?? key;
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/Id$/, "").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type" && issue.input === undefined) return "This field is required.";
  if (issue.code === "too_small" && issue.origin === "string") return Number(issue.minimum) <= 1 ? "This field is required." : `Use at least ${issue.minimum} characters.`;
  if (issue.code === "too_big" && issue.origin === "string") return `Use at most ${issue.maximum} characters.`;
  if (issue.code === "too_small" && issue.origin === "number") return `Must be at least ${issue.minimum}.`;
  if (issue.code === "too_big" && issue.origin === "number") return `Must be at most ${issue.maximum}.`;
  if (issue.code === "invalid_format" && issue.format === "email") return "Enter a valid email address.";
  return issue.message;
}

function prismaCode(err: unknown): string | null {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string"
    ? (err as { code: string }).code
    : null;
}

/** Largest JSON body any route accepts (the CSV import is the biggest at up to 2 MB of text). */
export const MAX_BODY_BYTES = 3 * 1024 * 1024;

/** Parse and validate a JSON body. With `emptyAs`, a request with no body at all is treated as that value. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S, emptyAs?: unknown): Promise<z.infer<S>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.", "payload_too_large");
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new HttpError(400, "Request body could not be read", "bad_request");
  }
  // Chunked requests carry no content-length, so check what actually arrived too.
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.", "payload_too_large");
  if (emptyAs !== undefined && text.trim() === "") return schema.parse(emptyAs);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON", "bad_request");
  }
  return schema.parse(body);
}

/** `?year=` → an integer year in a sane range, undefined when absent; anything else is a 400 (not an invalid Date → 500). */
export function yearParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "year must be between 2000 and 2100", "bad_request");
  return year;
}

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}
