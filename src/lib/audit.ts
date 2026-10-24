import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";
import type { Session } from "./session";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Append an audit entry (M9). Pass the transaction client so the entry commits with the change it describes. */
export async function audit(
  actor: Session,
  action: string,
  entity: string,
  entityId: string | null,
  change: { before?: unknown; after?: unknown } = {},
  tx: Tx = db,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.userId,
      actorRole: actor.role,
      actorName: actor.name ?? "",
      action,
      entity,
      entityId,
      before: toJson(change.before),
      after: toJson(change.after),
    },
  });
}

/** Decimal and Date values → plain JSON; never store password hashes. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (k, v) => (k === "passwordHash" ? undefined : v)));
}

export async function notify(
  userIds: (string | null | undefined)[],
  n: { title: string; body: string; link?: string },
  tx: Tx = db,
) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length) await tx.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
}
