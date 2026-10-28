import { z } from "zod";
import { audit } from "@/lib/audit";
import { signToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentCompanyId, runInCompany } from "@/lib/tenant";
import { badRequest, forbidden, HttpError, unauthorized } from "@/lib/errors";
import { hashPassword, passwordSchema, temporaryPassword, verifyPassword } from "@/lib/password";
import { assertRole, type Session } from "@/lib/session";

// ---------- Create a company (#01) ----------
// Every visitor can create their own company and becomes its Admin. Companies are fully separate:
// all data is scoped to the signed-in user's company (lib/tenant.ts, lib/db.ts), so a new company
// never sees or changes another one. Inside a company the brief's flow is unchanged: Admin creates
// HR logins, HR registers employees.

/** True only on a brand-new install (no company yet): the home page then opens "Create your company". */
export async function needsSetup(): Promise<boolean> {
  return (await db.companySettings.count()) === 0;
}

/** On a brand-new install the first Admin may come from ADMIN_EMAIL / ADMIN_PASSWORD in the env file. */
export function envAdmin(): { email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

// Signing up creates a company, so it needs a company address. Free personal mailboxes are refused.
// (Only for "Create your company": HR still registers employees with whatever address they use.)
export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru", "zoho.com", "tutanota.com", "hey.com",
]);
export const COMPANY_EMAIL_MESSAGE = "Please use your company email address to sign up.";

export function isCompanyEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return !!domain && !PERSONAL_EMAIL_DOMAINS.has(domain);
}

export const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(80),
  adminEmail: z.email().refine(isCompanyEmail, COMPANY_EMAIL_MESSAGE).optional(),
  adminPassword: passwordSchema.optional(),
});

// Section 3 quotas. These are company rules, not sample data; Admin can edit them in Settings.
const DEFAULT_LEAVE_TYPES = [
  { code: "annual", name: "Annual", yearlyQuota: 14, isPaid: true },
  { code: "sick", name: "Sick", yearlyQuota: 8, isPaid: true },
  { code: "casual", name: "Casual", yearlyQuota: 10, isPaid: true },
  { code: "unpaid", name: "Unpaid", yearlyQuota: null, isPaid: false },
];

// Spam brake: at most this many companies per client address per hour. In-memory, so per server instance
// (the same trade-off as the login throttle below).
export const MAX_COMPANIES_PER_HOUR = 5;
const companyCreations = new Map<string, number[]>();

function companyThrottle(key: string, now: number) {
  const recent = (companyCreations.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= MAX_COMPANIES_PER_HOUR) {
    throw new HttpError(429, "Too many companies were created from this network. Please try again later.", "rate_limited");
  }
  companyCreations.set(key, [...recent, now]);
  if (companyCreations.size > 10_000) companyCreations.delete(companyCreations.keys().next().value!); // bound memory
}

/** Test hook: forget recent company creations. */
export function resetCompanyThrottle() {
  companyCreations.clear();
}

/** Creates a company with its Admin account. Runs unscoped (no company yet), then inside the new company. */
export async function runSetup(input: z.infer<typeof setupSchema>, clientKey = "local", now = Date.now()) {
  // The env Admin only applies to the very first company of a fresh install, never to later sign-ups.
  const fromEnv = (await needsSetup()) ? envAdmin() : null;
  const email = (input.adminEmail ?? fromEnv?.email)?.toLowerCase();
  const password = input.adminPassword ?? fromEnv?.password;
  if (!email || !password) throw badRequest("Admin email and password are required.");
  if (await db.user.findUnique({ where: { email } })) {
    throw new HttpError(409, "An account with this email already exists. Sign in instead, or use another email.", "conflict");
  }
  companyThrottle(clientKey, now);

  const passwordHash = await hashPassword(password);
  const admin = await db.$transaction(async (tx) => {
    const company = await tx.companySettings.create({ data: { companyName: input.companyName } });
    // Everything else is written inside the new company.
    return runInCompany(company.id, async () => {
      await tx.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, companyId: company.id })) });
      const user = await tx.user.create({ data: { companyId: company.id, email, name: input.adminName, passwordHash, role: "ADMIN" } });
      const actor: Session = { userId: user.id, companyId: company.id, role: "ADMIN", employeeId: null, name: input.adminName };
      await audit(actor, "setup", "company", String(company.id), { after: { companyName: input.companyName, adminEmail: email } }, tx);
      return user;
    });
  });
  return { token: await signToken(admin.id) };
}

// ---------- Login / password (#02) ----------

export const loginSchema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

let dummyHash: Promise<string> | null = null;

// Brute-force brake: after MAX_FAILED_LOGINS wrong passwords for one email within the window, further attempts get 429
// until the window passes. In-memory, so it is per server instance (enough to stop a scripted guesser on one instance;
// a shared store would be needed to enforce it across many serverless instances).
export const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; first: number }>();

function loginThrottle(key: string, now: number) {
  const f = failedLogins.get(key);
  if (f && now - f.first > LOGIN_WINDOW_MS) failedLogins.delete(key);
  const current = failedLogins.get(key);
  if (current && current.count >= MAX_FAILED_LOGINS) {
    throw new HttpError(429, "Too many failed sign-in attempts. Please wait 15 minutes and try again.", "rate_limited");
  }
}

function recordFailedLogin(key: string, now: number) {
  const f = failedLogins.get(key);
  failedLogins.set(key, f ? { count: f.count + 1, first: f.first } : { count: 1, first: now });
  if (failedLogins.size > 10_000) failedLogins.delete(failedLogins.keys().next().value!); // bound memory
}

/** Test hook: forget all failed attempts. */
export function resetLoginThrottle() {
  failedLogins.clear();
}

export async function login(email: string, password: string, now = Date.now()) {
  const key = email.trim().toLowerCase();
  loginThrottle(key, now);
  const user = await db.user.findUnique({ where: { email: key } });
  // Same message for unknown email and wrong password; a hash compare runs either way so timing doesn't leak which.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await (dummyHash ??= hashPassword("not-a-real-password"))));
  if (!user || !ok) {
    recordFailedLogin(key, now);
    throw unauthorized("Email or password is incorrect.");
  }
  failedLogins.delete(key);
  if (!user.isActive) throw forbidden("This account has been deactivated. Contact your administrator.");
  return { token: await signToken(user.id), mustChangePassword: user.mustChangePassword };
}

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export async function changePassword(actor: Session, currentPassword: string, newPassword: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect.");
  if (currentPassword === newPassword) throw badRequest("Choose a password different from the current one.");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    await audit(actor, "change_password", "user", user.id, {}, tx);
  });
}

// ---------- User management (#05, Admin) ----------

export async function listUsers(actor: Session) {
  assertRole(actor, "ADMIN");
  const users = await db.user.findMany({
    include: { employee: { select: { id: true, code: true, fullName: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.employee?.fullName || u.name,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    employee: u.employee,
    createdAt: u.createdAt,
  }));
}

export const createHrSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.email() });

/** Admin creates an HR login. The temporary password is returned once and must be changed on first sign-in. */
export async function createHrUser(actor: Session, input: z.infer<typeof createHrSchema>) {
  assertRole(actor, "ADMIN");
  const tempPassword = temporaryPassword();
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { companyId: currentCompanyId(), email: input.email.toLowerCase(), name: input.name, role: "HR", passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
    });
    await audit(actor, "create", "user", u.id, { after: { email: u.email, name: u.name, role: u.role } }, tx);
    return u;
  });
  return { id: user.id, email: user.email, tempPassword };
}

export const updateUserSchema = z.object({ isActive: z.boolean().optional(), role: z.enum(["HR", "EMPLOYEE"]).optional() });

export async function updateUser(actor: Session, userId: string, input: z.infer<typeof updateUserSchema>) {
  assertRole(actor, "ADMIN");
  if (userId === actor.userId) throw badRequest("You cannot change your own account here.");
  const before = await db.user.findUnique({ where: { id: userId }, include: { employee: true } });
  if (!before) throw new HttpError(404, "User not found", "not_found");
  if (before.role === "ADMIN") throw forbidden("Admin accounts cannot be changed here.");
  if (input.role === "EMPLOYEE" && !before.employee) throw badRequest("Only users with an employee record can be employees.");

  const after = await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: input });
    const action = input.isActive === false ? "deactivate" : input.isActive === true ? "activate" : "update";
    await audit(actor, action, "user", userId, { before: { isActive: before.isActive, role: before.role }, after: { isActive: u.isActive, role: u.role } }, tx);
    return u;
  });
  return { id: after.id, isActive: after.isActive, role: after.role };
}

export async function resetPassword(actor: Session, userId: string) {
  assertRole(actor, "ADMIN");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "User not found", "not_found");
  const tempPassword = temporaryPassword();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true } });
    await audit(actor, "reset_password", "user", userId, {}, tx);
  });
  return { email: user.email, tempPassword };
}
