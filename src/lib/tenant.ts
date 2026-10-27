import { AsyncLocalStorage } from "node:async_hooks";

// Which company the current request works in. Every table except `settings` (the company row itself)
// carries a companyId, and the client in db.ts adds it to every query from this context.
//
//   withSession (lib/api.ts) → runInCompany(session.companyId)   signed-in requests
//   publicRoute / sign-in lookups → runAsSystem()                 login, "create your company", session lookup
//   no context at all → the query throws                           fail closed: a missed spot can't read other companies

type Scope = { kind: "company"; companyId: number } | { kind: "system" };

const storage = new AsyncLocalStorage<Scope>();

// Both helpers await `fn` *inside* the context. Prisma queries are lazy: a query returned without being awaited
// would otherwise run later, outside this context (in the caller's company, or with no company at all).

export function runInCompany<T>(companyId: number, fn: () => T | Promise<T>): Promise<T> {
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error(`Invalid companyId: ${companyId}`);
  return storage.run({ kind: "company", companyId }, async () => await fn());
}

/** Unscoped access, only for flows that come before a company is known (sign-in, creating a company). */
export function runAsSystem<T>(fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ kind: "system" }, async () => await fn());
}

export function currentScope(): Scope | undefined {
  return storage.getStore();
}

/** The company of the current request. Throws outside a company context. */
export function currentCompanyId(): number {
  const scope = storage.getStore();
  if (scope?.kind !== "company") throw new Error("No company in the current context");
  return scope.companyId;
}
