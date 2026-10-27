import { forbidden } from "./errors";

export type Role = "ADMIN" | "HR" | "EMPLOYEE";

/** The signed-in user. Every service takes this as its first argument so scope is checked in one place. */
export interface Session {
  userId: string;
  /** The user's company. Every query in the request is scoped to it (lib/tenant.ts, lib/db.ts). */
  companyId: number;
  role: Role;
  /** Admin accounts may have no employee record. */
  employeeId: string | null;
  name?: string;
}

export function assertRole(actor: Session, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) throw forbidden();
}

/**
 * Resolve which employee a query may look at.
 * Employees are always pinned to their own record; asking for anyone else is a 403, not a silent swap.
 */
export function scopeEmployeeId(actor: Session, requested?: string | null): string | null {
  if (actor.role === "EMPLOYEE") {
    if (!actor.employeeId) throw forbidden("Your login is not linked to an employee record");
    if (requested && requested !== actor.employeeId) throw forbidden();
    return actor.employeeId;
  }
  return requested ?? null;
}
