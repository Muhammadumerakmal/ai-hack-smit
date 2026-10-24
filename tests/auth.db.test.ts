import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as changePw from "@/app/api/auth/change-password/route";
import * as login from "@/app/api/auth/login/route";
import * as me from "@/app/api/auth/me/route";
import * as employees from "@/app/api/employees/route";
import * as setup from "@/app/api/setup/route";
import * as users from "@/app/api/users/route";
import * as userById from "@/app/api/users/[id]/route";
import * as resetPw from "@/app/api/users/[id]/reset-password/route";
import { call, hasDb, seed } from "./helpers";

// M1: first-run setup, login, temporary passwords, deactivation, Admin-only user management.
describe.skipIf(!hasDb)("M1 auth", () => {
  const db = new PrismaClient();
  afterAll(() => db.$disconnect());

  describe("first-run setup", () => {
    beforeAll(async () => {
      await seed(db);
      await db.$executeRawUnsafe(
        `TRUNCATE ai_logs, audit_logs, notifications, announcements, payslips, payroll_runs, attendance_corrections, leave_requests, attendance, employees, users, holidays, leave_types, designations, departments, settings RESTART IDENTITY CASCADE`,
      );
    });

    it("reports a fresh install, creates company + Admin once, then refuses", async () => {
      expect((await call(setup.GET)).body).toMatchObject({ needsSetup: true });

      const body = { companyName: "Acme", adminName: "Ayesha", adminEmail: "Admin@Acme.test", adminPassword: "secret123" };
      const first = await call(setup.POST, { body });
      expect(first.status).toBe(200);
      expect(first.headers.get("set-cookie")).toMatch(/token=/);
      expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i);

      const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@acme.test" } });
      expect(admin.role).toBe("ADMIN");
      expect(admin.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt, never plain text
      expect(await db.leaveType.count()).toBe(4); // Section 3 quotas
      expect((await db.companySettings.findUniqueOrThrow({ where: { id: 1 } })).companyName).toBe("Acme");

      expect((await call(setup.POST, { body: { ...body, adminEmail: "x@acme.test" } })).status).toBe(409);
      expect((await call(setup.GET)).body).toMatchObject({ needsSetup: false });
    });

    it("signs the Admin in with the chosen password", async () => {
      const ok = await call(login.POST, { body: { email: "admin@acme.test", password: "secret123" } });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ ok: true, mustChangePassword: false });
    });
  });

  describe("login, temporary passwords and deactivation", () => {
    let ids: Record<string, string>;
    beforeAll(async () => {
      await seed(db);
      const all = await db.user.findMany();
      ids = Object.fromEntries(all.map((u) => [u.email.split("@")[0], u.id]));
    });

    it("rejects a wrong password and an unknown email with the same 401", async () => {
      const bad = await call(login.POST, { body: { email: "hr@demo.test", password: "wrong-password1" } });
      const unknown = await call(login.POST, { body: { email: "nobody@demo.test", password: "wrong-password1" } });
      expect(bad.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(bad.body.message).toBe(unknown.body.message);
    });

    it("rejects requests without a valid session", async () => {
      expect((await call(employees.GET)).status).toBe(401);
      const forged = new Request("http://test.local/api/employees", { headers: { cookie: "token=not.a.jwt" } });
      expect((await employees.GET(forged)).status).toBe(401);
    });

    it("HR-registered employee must change the temporary password before using the app", async () => {
      const dept = await db.department.findFirstOrThrow({ where: { name: "Sales" } });
      const created = await call(employees.POST, {
        userId: ids.hr,
        body: { fullName: "Nida Noor", email: "nida@demo.test", departmentId: dept.id, joinDate: "2026-10-01", basicSalary: 90000 },
      });
      expect(created.status).toBe(200);
      const temp = created.body.tempPassword as string;
      expect(temp).toMatch(/^[a-z]{4}-\d{4}-[A-Z]{2}$/);

      const signIn = await call(login.POST, { body: { email: "nida@demo.test", password: temp } });
      expect(signIn.body).toMatchObject({ ok: true, mustChangePassword: true });
      const nida = await db.user.findUniqueOrThrow({ where: { email: "nida@demo.test" } });

      // Everything except /me and change-password is blocked until the password is changed.
      const blocked = await call(employees.GET, { userId: nida.id });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe("password_change_required");
      expect((await call(me.GET, { userId: nida.id })).body).toMatchObject({ role: "EMPLOYEE", mustChangePassword: true });

      expect((await call(changePw.POST, { userId: nida.id, body: { currentPassword: "nope", newPassword: "newpass123" } })).status).toBe(400);
      expect((await call(changePw.POST, { userId: nida.id, body: { currentPassword: temp, newPassword: "short" } })).status).toBe(400);
      expect((await call(changePw.POST, { userId: nida.id, body: { currentPassword: temp, newPassword: "newpass123" } })).status).toBe(200);

      const now = await call(employees.GET, { userId: nida.id });
      expect(now.status).toBe(200);
      expect(now.body.items).toHaveLength(1); // only her own row
      expect((await call(login.POST, { body: { email: "nida@demo.test", password: "newpass123" } })).body.mustChangePassword).toBe(false);
    });

    it("Admin deactivates a login: existing sessions stop working and sign-in is refused", async () => {
      const off = await call(userById.PATCH, { userId: ids.admin, params: { id: ids.bilal }, body: { isActive: false } });
      expect(off.status).toBe(200);
      expect((await call(employees.GET, { userId: ids.bilal })).status).toBe(401);

      const reset = await call(resetPw.POST, { userId: ids.admin, params: { id: ids.bilal } });
      expect(reset.status).toBe(200);
      const signIn = await call(login.POST, { body: { email: "bilal@demo.test", password: reset.body.tempPassword } });
      expect(signIn.status).toBe(403);

      await call(userById.PATCH, { userId: ids.admin, params: { id: ids.bilal }, body: { isActive: true } });
      expect((await call(login.POST, { body: { email: "bilal@demo.test", password: reset.body.tempPassword } })).body.mustChangePassword).toBe(true);

      const actions = (await db.auditLog.findMany({ where: { entityId: ids.bilal } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["deactivate", "reset_password", "activate"]));
    });

    it("only Admin manages logins", async () => {
      expect((await call(users.GET, { userId: ids.sara })).status).toBe(403);
      expect((await call(users.GET, { userId: ids.hr })).status).toBe(403);
      expect((await call(users.POST, { userId: ids.hr, body: { name: "X", email: "x@demo.test" } })).status).toBe(403);
      expect((await call(users.GET, { userId: ids.admin })).status).toBe(200);
    });

    it("Admin creates an HR login with a temporary password", async () => {
      const r = await call(users.POST, { userId: ids.admin, body: { name: "Omar HR", email: "omar@demo.test" } });
      expect(r.status).toBe(200);
      const u = await db.user.findUniqueOrThrow({ where: { email: "omar@demo.test" } });
      expect(u).toMatchObject({ role: "HR", mustChangePassword: true });
      expect((await call(login.POST, { body: { email: "omar@demo.test", password: r.body.tempPassword } })).status).toBe(200);
    });

    it("Admin cannot change their own account or other Admins", async () => {
      expect((await call(userById.PATCH, { userId: ids.admin, params: { id: ids.admin }, body: { isActive: false } })).status).toBe(400);
    });
  });
});
