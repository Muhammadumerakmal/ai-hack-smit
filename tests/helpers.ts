import { PrismaClient } from "@prisma/client";
import { signToken } from "@/lib/auth";
import type { Session } from "@/lib/session";
import { seedDemo } from "../scripts/dev-seed";

// Shared test helpers. Each test file seeds its own database (TEST_DATABASE_URL) and calls route handlers directly.

export const hasDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");

/** Wipes the test DB and creates the demo company: admin@demo.test (no employee), hr@demo.test (HR, E001), ali/sara/bilal/zara (employees). */
export async function seed(db: PrismaClient) {
  await db.$executeRawUnsafe(
    `TRUNCATE ai_logs, audit_logs, notifications, announcements, payslips, payroll_runs, attendance_corrections, leave_requests, attendance, employees, users, holidays, leave_types, designations, departments, settings RESTART IDENTITY CASCADE`,
  );
  return seedDemo(db);
}

export async function sessionFor(db: PrismaClient, email: string): Promise<Session> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { employee: true } });
  return { userId: u.id, companyId: u.companyId, role: u.role, employeeId: u.employee?.id ?? null, name: u.employee?.fullName ?? u.name ?? u.email };
}

// Loose on purpose: withSession<{ month: string }> etc. must all be accepted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx?: any) => Promise<Response>;

/** Call a route handler the way Next.js would, signed in as `userId` (or anonymous). */
export async function call(
  handler: Handler,
  opts: { userId?: string; method?: string; url?: string; body?: unknown; params?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.userId) headers.cookie = `token=${await signToken(opts.userId)}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://test.local${opts.url ?? "/"}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : type.includes("pdf") ? new Uint8Array(await res.arrayBuffer()) : await res.text();
  return { status: res.status, body, headers: res.headers };
}
