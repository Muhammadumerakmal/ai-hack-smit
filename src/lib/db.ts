import { PrismaClient } from "@prisma/client";
import { currentScope } from "./tenant";

// One company per signed-in user. This client adds the current company (lib/tenant.ts) to every query,
// so services never filter by company themselves and can't forget to:
//   reads, updates, deletes, counts → where.companyId = current company
//   creates (also createMany, upsert)  → data.companyId = current company
//   the company row itself (settings)  → where.id = current company
// With no company in context the query throws, unless the caller opted into runAsSystem().

/** Operations whose `where` gets the company filter. */
const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = Record<string, unknown> & { where?: object; data?: unknown; create?: object };

export function scopeArgs(model: string, operation: string, args: Args | undefined, companyId: number): Args {
  const out: Args = { ...(args ?? {}) };
  const key = model === "CompanySettings" ? "id" : "companyId";
  if (WHERE_OPS.has(operation)) out.where = { ...(out.where ?? {}), [key]: companyId };
  if (operation === "create") out.data = { ...(out.data as object), [key]: companyId };
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(out.data) ? out.data : [out.data];
    out.data = rows.map((row) => ({ ...(row as object), [key]: companyId }));
  }
  if (operation === "upsert") out.create = { ...(out.create ?? {}), [key]: companyId };
  return out;
}

function createClient() {
  const base = new PrismaClient();
  const scoped = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scope = currentScope();
          if (scope?.kind === "system") return query(args);
          if (!scope) throw new Error(`Database access to ${model}.${operation} outside a company context`);
          return query(scopeArgs(model, operation, args as Args, scope.companyId));
        },
      },
    },
  });
  // A query-only extension keeps every model type, so the plain client type still describes it
  // (and Prisma.TransactionClient keeps working for helpers that take a transaction).
  return scoped as unknown as PrismaClient;
}

// Reuse one client across hot reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
