import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { audit, notify } from "@/lib/audit";
import { db } from "@/lib/db";
import { currentCompanyId } from "@/lib/tenant";
import { assertRole, type Session } from "@/lib/session";

// M9 Comms & Audit: announcements (Admin/HR post, everyone reads), in-app notifications (own only),
// and the read side of the append-only audit log (Admin only).

// ---------- Announcements (#23) ----------

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(2000),
});

export async function listAnnouncements(limit = 10) {
  const rows = await db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 50) });
  return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, authorName: a.authorName, createdAt: a.createdAt.toISOString() }));
}

/** Posting notifies every other active user; the post and its notifications commit together. */
export async function postAnnouncement(actor: Session, input: z.infer<typeof announcementSchema>) {
  assertRole(actor, "ADMIN", "HR");
  return db.$transaction(async (tx) => {
    const a = await tx.announcement.create({ data: { ...input, companyId: currentCompanyId(), authorId: actor.userId, authorName: actor.name ?? "" } });
    const recipients = await tx.user.findMany({ where: { isActive: true, id: { not: actor.userId } }, select: { id: true } });
    await notify(
      recipients.map((r) => r.id),
      { title: `Announcement: ${a.title}`, body: a.body.length > 140 ? `${a.body.slice(0, 137)}…` : a.body, link: "/announcements" },
      tx,
    );
    await audit(actor, "create", "announcement", a.id, { after: input }, tx);
    return { id: a.id, title: a.title, body: a.body, authorName: a.authorName, createdAt: a.createdAt.toISOString(), notified: recipients.length };
  });
}

// ---------- Notifications (#24) ----------

export async function listNotifications(actor: Session) {
  const [unread, items] = await Promise.all([
    db.notification.count({ where: { userId: actor.userId, readAt: null } }),
    db.notification.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    unread,
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export const markReadSchema = z.object({ ids: z.array(z.string().min(1)).max(100).optional() });

/** Marks the caller's own notifications as read: the given ids, or all of them. Other users' ids are ignored. */
export async function markNotificationsRead(actor: Session, ids?: string[]) {
  const { count } = await db.notification.updateMany({
    where: { userId: actor.userId, readAt: null, ...(ids?.length && { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return { marked: count };
}

// ---------- Audit log (#25, Admin view only; there is no update or delete path) ----------

export async function listAuditLog(actor: Session, q: { entity?: string; action?: string; page?: number; pageSize?: number } = {}) {
  assertRole(actor, "ADMIN");
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(Math.max(q.pageSize ?? 25, 1), 100);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.entity && { entity: q.entity }),
    ...(q.action && { action: q.action }),
  };
  const [total, rows, entities, actions] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    page,
    pageSize,
    total,
    filters: { entities: entities.map((e) => e.entity), actions: actions.map((a) => a.action) },
    items: rows.map(toAuditItem),
  };
}

export async function latestAudit(take = 10) {
  return (await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take })).map(toAuditItem);
}

function toAuditItem(r: Prisma.AuditLogGetPayload<object>) {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorName,
    actorRole: r.actorRole,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    before: r.before,
    after: r.after,
  };
}
