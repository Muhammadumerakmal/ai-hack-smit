import { z } from "zod";
import { audit } from "@/lib/audit";
import { signToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { badRequest, forbidden, HttpError, unauthorized } from "@/lib/errors";
import { hashPassword, passwordSchema, temporaryPassword, verifyPassword } from "@/lib/password";
import { assertRole, type Session } from "@/lib/session";

// ---------- First-run setup (#01) ----------

export async function needsSetup(): Promise<boolean> {
  return (await db.user.count()) === 0;
}

/** Admin credentials may come from the form or from ADMIN_EMAIL / ADMIN_PASSWORD in the env file. */
export function envAdmin(): { email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

export const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(80),
  adminEmail: z.email().optional(),
  adminPassword: passwordSchema.optional(),
});

// Section 3 quotas. These are company rules, not sample data; Admin can edit them in Settings.
const DEFAULT_LEAVE_TYPES = [
  { code: "annual", name: "Annual", yearlyQuota: 14, isPaid: true },
  { code: "sick", name: "Sick", yearlyQuota: 8, isPaid: true },
  { code: "casual", name: "Casual", yearlyQuota: 10, isPaid: true },
  { code: "unpaid", name: "Unpaid", yearlyQuota: null, isPaid: false },
];

export async function runSetup(input: z.infer<typeof setupSchema>) {
  const fromEnv = envAdmin();
  const email = (input.adminEmail ?? fromEnv?.email)?.toLowerCase();
  const password = input.adminPassword ?? fromEnv?.password;
  if (!email || !password) throw badRequest("Admin email and password are required.");

  const passwordHash = await hashPassword(password);
  const admin = await db.$transaction(async (tx) => {
    // Checked inside the transaction so two setup submissions cannot both win.
    if ((await tx.user.count()) > 0) throw new HttpError(409, "Setup has already been completed.", "conflict");
    await tx.companySettings.create({ data: { id: 1, companyName: input.companyName } });
    await tx.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES });
    const user = await tx.user.create({ data: { email, name: input.adminName, passwordHash, role: "ADMIN" } });
    const actor: Session = { userId: user.id, role: "ADMIN", employeeId: null, name: input.adminName };
    await audit(actor, "setup", "company", "1", { after: { companyName: input.companyName, adminEmail: email } }, tx);
    return user;
  });
  return { token: await signToken(admin.id) };
}

// ---------- Login / password (#02) ----------

export const loginSchema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

let dummyHash: Promise<string> | null = null;

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Same message for unknown email and wrong password; a hash compare runs either way so timing doesn't leak which.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await (dummyHash ??= hashPassword("not-a-real-password"))));
  if (!user || !ok) throw unauthorized("Email or password is incorrect.");
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
      data: { email: input.email.toLowerCase(), name: input.name, role: "HR", passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
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
