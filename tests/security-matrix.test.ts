import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signToken } from "@/lib/auth";
import { setLlm } from "@/server/ai/llm";
import { hasDb, seed } from "./helpers";

// Endpoint × role matrix (QA-1). Every route.ts under src/app/api is imported through a glob, so a new route
// that is missing from ACCESS below fails the "every route is covered" test.

type Role = "ADMIN" | "HR" | "EMPLOYEE";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx?: any) => Promise<Response>;

const modules = import.meta.glob("../src/app/api/**/route.ts", { eager: true }) as Record<string, Record<string, Handler>>;
const routeOf = (file: string) => file.replace("../src/app", "").replace("/route.ts", "");

const ALL: Role[] = ["ADMIN", "HR", "EMPLOYEE"];
const FUTURE_MONDAY = "2099-01-05";

interface Access {
  /** roles allowed through; everyone else must get 403. "public" routes skip the auth checks. */
  allowed: Role[] | "public";
  params?: Record<string, string>;
  query?: string;
  /** body sent by denied roles (valid enough that a 403 decided inside a service can surface) */
  body?: unknown;
  /** body sent by allowed roles (harmless: invalid or pointing at nothing) — defaults to body */
  allowedBody?: unknown;
}

const NOPE = { id: "does-not-exist" };

// Expected access per the brief's Section 2 and Section 8 checklist.
const ACCESS: Record<string, Access> = {
  "POST /api/ai/chat": { allowed: ALL, body: { messages: [{ role: "user", content: "hi" }] } },
  "POST /api/ai/smart-leave": { allowed: ["HR", "EMPLOYEE"], body: { text: "next monday off" } },
  "POST /api/ai/summary": { allowed: ["ADMIN", "HR"], body: {} },
  "GET /api/announcements": { allowed: ALL },
  "POST /api/announcements": { allowed: ["ADMIN", "HR"], body: { title: "Hello all", body: "x" }, allowedBody: { title: "x" } },
  "GET /api/attendance/board": { allowed: ["ADMIN", "HR"] },
  "GET /api/attendance/calendar": { allowed: ALL },
  "POST /api/attendance/check-in": { allowed: ["HR", "EMPLOYEE"] },
  "POST /api/attendance/check-out": { allowed: ["HR", "EMPLOYEE"] },
  "POST /api/attendance/corrections/[id]/decision": { allowed: ["HR"], params: NOPE, body: { approve: true, comment: "ok" } },
  "GET /api/attendance/corrections": { allowed: ALL },
  "POST /api/attendance/corrections": { allowed: ["HR", "EMPLOYEE"], body: {} },
  "GET /api/attendance/today": { allowed: ["HR", "EMPLOYEE"] },
  "GET /api/audit": { allowed: ["ADMIN"] },
  "POST /api/auth/change-password": { allowed: ALL, body: { currentPassword: "wrong-one", newPassword: "Abcdefg123" } },
  "POST /api/auth/login": { allowed: "public", body: { email: "nobody@demo.test", password: "x" } },
  "POST /api/auth/logout": { allowed: "public" },
  "GET /api/auth/me": { allowed: ALL },
  "GET /api/dashboard": { allowed: ALL },
  "GET /api/employees/[id]": { allowed: ALL, params: { id: "SARA" } },
  "PATCH /api/employees/[id]": { allowed: ["HR", "EMPLOYEE"], params: { id: "SARA" }, body: { phone: "0300-1234567" } },
  "GET /api/employees/export": { allowed: ["HR"] },
  "POST /api/employees/import": { allowed: ["HR"], body: { csv: "code\n", dryRun: true } },
  "GET /api/employees": { allowed: ALL },
  "POST /api/employees": { allowed: ["HR"], body: {} },
  "GET /api/leave-balance": { allowed: ALL },
  "POST /api/leave-requests/[id]/cancel": { allowed: ALL, params: NOPE },
  "POST /api/leave-requests/[id]/decision": { allowed: ["HR"], params: NOPE, body: { decision: "APPROVED", comment: "ok" } },
  "GET /api/leave-requests": { allowed: ALL },
  "POST /api/leave-requests": {
    allowed: ["HR", "EMPLOYEE"],
    body: { type: "casual", start: FUTURE_MONDAY, end: FUTURE_MONDAY, reason: "matrix" },
    allowedBody: {},
  },
  "GET /api/notifications": { allowed: ALL },
  "POST /api/notifications/read": { allowed: ALL, body: {} },
  "PATCH /api/org/departments/[id]": { allowed: ["ADMIN"], params: NOPE, body: { name: "Renamed dept" } },
  "DELETE /api/org/departments/[id]": { allowed: ["ADMIN"], params: NOPE },
  "GET /api/org/departments": { allowed: ALL },
  "POST /api/org/departments": { allowed: ["ADMIN"], body: { name: "New dept" }, allowedBody: { name: "" } },
  "PATCH /api/org/designations/[id]": { allowed: ["ADMIN"], params: NOPE, body: { name: "Renamed title" } },
  "DELETE /api/org/designations/[id]": { allowed: ["ADMIN"], params: NOPE },
  "GET /api/org/designations": { allowed: ALL },
  "POST /api/org/designations": { allowed: ["ADMIN"], body: { name: "New title" }, allowedBody: { name: "" } },
  "DELETE /api/org/holidays/[id]": { allowed: ["ADMIN"], params: NOPE },
  "GET /api/org/holidays": { allowed: ALL },
  "POST /api/org/holidays": { allowed: ["ADMIN"], body: { date: "2099-03-23", name: "Pakistan Day" }, allowedBody: {} },
  "PATCH /api/org/leave-types/[id]": { allowed: ["ADMIN"], params: NOPE, body: { code: "casual", name: "Casual", yearlyQuota: 10, isPaid: true } },
  "GET /api/org/leave-types": { allowed: ALL },
  "POST /api/org/leave-types": { allowed: ["ADMIN"], body: { code: "study", name: "Study", yearlyQuota: 5, isPaid: true }, allowedBody: {} },
  "GET /api/org/settings": { allowed: ["ADMIN", "HR"] },
  "PUT /api/org/settings": { allowed: ["ADMIN"], body: {} },
  "POST /api/payroll/runs/[month]/finalize": { allowed: ["ADMIN"], params: { month: "2001-01" } },
  "GET /api/payroll/runs/[month]": { allowed: ["ADMIN", "HR"], params: { month: "2001-01" } },
  "GET /api/payroll/runs": { allowed: ["ADMIN", "HR"] },
  "POST /api/payroll/runs": { allowed: ["HR"], body: { month: "bad" } },
  "GET /api/payslips/[id]/pdf": { allowed: ALL, params: NOPE },
  "GET /api/payslips": { allowed: ALL },
  "GET /api/setup": { allowed: "public" },
  "POST /api/setup": { allowed: "public", body: {} },
  "POST /api/users/[id]/reset-password": { allowed: ["ADMIN"], params: NOPE },
  "PATCH /api/users/[id]": { allowed: ["ADMIN"], params: NOPE, body: { isActive: false } },
  "GET /api/users": { allowed: ["ADMIN"] },
  "POST /api/users": { allowed: ["ADMIN"], body: { name: "New HR", email: "new.hr@demo.test" }, allowedBody: {} },
};

const ROUTES = Object.entries(modules).flatMap(([file, mod]) =>
  (["GET", "POST", "PUT", "PATCH", "DELETE"] as Method[]).filter((m) => typeof mod[m] === "function").map((m) => ({ key: `${m} ${routeOf(file)}`, method: m, path: routeOf(file), handler: mod[m] })),
);

async function callWith(handler: Handler, method: Method, path: string, token: string | null, a: Access, body: unknown) {
  const params = { ...(a.params ?? {}) };
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `token=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const url = `http://test.local${path.replace(/\[(\w+)\]/g, (_, k) => params[k] ?? k)}${a.query ?? ""}`;
  const req = new Request(url, { method, headers, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, text };
}

describe.skipIf(!hasDb)("security: endpoint × role matrix", () => {
  const db = new PrismaClient();
  const tokens: Record<string, string> = {};
  let saraEmployeeId = "";

  beforeAll(async () => {
    await seed(db);
    const u = async (email: string) => db.user.findUniqueOrThrow({ where: { email }, include: { employee: true } });
    const [admin, hr, sara] = await Promise.all([u("admin@demo.test"), u("hr@demo.test"), u("sara@demo.test")]);
    saraEmployeeId = sara.employee!.id;
    tokens.ADMIN = await signToken(admin.id);
    tokens.HR = await signToken(hr.id);
    tokens.EMPLOYEE = await signToken(sara.id);

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const past = Math.floor(Date.now() / 1000) - 3600;
    tokens.expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt(past - 60).setExpirationTime(past).sign(secret);
    tokens.forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setExpirationTime("1h").sign(new TextEncoder().encode("not-the-real-secret"));
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    tokens.algNone = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: admin.id, exp: past + 7200 })}.`;
    const gone = await db.user.create({ data: { email: "gone@demo.test", name: "Gone", passwordHash: "x", role: "ADMIN", isActive: false } });
    tokens.deactivated = await signToken(gone.id);
    tokens.unknownUser = await signToken("no-such-user-id");

    // AI routes run against a scripted model: no provider calls, no cost.
    setLlm({ complete: async () => ({ content: '{"bullets":[]}', toolCalls: [], model: "fake" }) });
  });

  afterAll(async () => {
    setLlm(null);
    await db.$disconnect();
  });

  it("every route file is in the access table (nothing unaudited)", () => {
    const missing = ROUTES.map((r) => r.key).filter((k) => !ACCESS[k]);
    const stale = Object.keys(ACCESS).filter((k) => !ROUTES.some((r) => r.key === k));
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("rejects anonymous, expired, forged, alg=none, unknown-user and deactivated tokens with 401", async () => {
    const failures: string[] = [];
    for (const r of ROUTES) {
      const a = ACCESS[r.key];
      if (!a || a.allowed === "public") continue;
      for (const who of ["anonymous", "expired", "forged", "algNone", "unknownUser", "deactivated"]) {
        const res = await callWith(r.handler, r.method, r.path, who === "anonymous" ? null : tokens[who], a, a.body);
        if (res.status !== 401) failures.push(`${r.key} as ${who} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("returns 403 to every role the brief does not allow", async () => {
    const failures: string[] = [];
    for (const r of ROUTES) {
      const a = ACCESS[r.key];
      if (!a || a.allowed === "public") continue;
      const params = { ...a.params, ...(a.params?.id === "SARA" ? { id: saraEmployeeId } : {}) };
      for (const role of ALL.filter((x) => !(a.allowed as Role[]).includes(x))) {
        const res = await callWith(r.handler, r.method, r.path, tokens[role], { ...a, params }, a.body);
        if (res.status !== 403) failures.push(`${r.key} as ${role} → ${res.status} ${res.text.slice(0, 120)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("lets allowed roles through, with no 401/403 and never a 500 (harmless inputs)", async () => {
    const failures: string[] = [];
    for (const r of ROUTES) {
      const a = ACCESS[r.key];
      if (!a) continue;
      const params = { ...a.params, ...(a.params?.id === "SARA" ? { id: saraEmployeeId } : {}) };
      const roles: (Role | null)[] = a.allowed === "public" ? [null] : a.allowed;
      for (const role of roles) {
        const res = await callWith(r.handler, r.method, r.path, role ? tokens[role] : null, { ...a, params }, a.allowedBody ?? a.body);
        const bad = res.status >= 500 || (a.allowed !== "public" && (res.status === 401 || res.status === 403));
        if (bad) failures.push(`${r.key} as ${role ?? "public"} → ${res.status} ${res.text.slice(0, 160)}`);
        if (res.status >= 500 && /prisma|stack|at \w+ \(|invalid `/i.test(res.text)) failures.push(`${r.key}: 500 leaks internals`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("returns 404 (not 500) for ids that do not exist", async () => {
    const failures: string[] = [];
    for (const r of ROUTES) {
      const a = ACCESS[r.key];
      if (!a || a.params?.id !== "does-not-exist" || a.allowed === "public") continue;
      const role = (a.allowed as Role[])[0];
      const res = await callWith(r.handler, r.method, r.path, tokens[role], a, a.body);
      if (res.status !== 404) failures.push(`${r.key} as ${role} → ${res.status} ${res.text.slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
  });
});
