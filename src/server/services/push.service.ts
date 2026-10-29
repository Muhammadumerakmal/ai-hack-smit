import { after } from "next/server";
import webpush from "web-push";
import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import type { Session } from "@/lib/session";
import { currentCompanyId, runInCompany } from "@/lib/tenant";

// Push alerts on phones and computers (Web Push, like app notifications), even with the site closed.
// Every in-app notification (lib/audit.ts notify) is also pushed to the recipient's subscribed devices.
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT. Without them push is simply off.

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** The public half of the key pair: the browser needs it to subscribe. */
export function publicKey(): { enabled: boolean; publicKey: string | null } {
  return { enabled: pushConfigured(), publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null };
}

export const subscriptionSchema = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "Push endpoints are https"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Save (or move to this user) the device's subscription. The same endpoint signing in as someone else is re-owned. */
export async function subscribe(actor: Session, sub: z.infer<typeof subscriptionSchema>) {
  if (!pushConfigured()) throw badRequest("Push alerts are not set up on this server.");
  // Endpoints are unique across companies; drop any old owner first, then save it for this user.
  await db.$transaction(async (tx) => {
    await tx.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
    await tx.pushSubscription.create({
      data: { companyId: currentCompanyId(), userId: actor.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  });
  return { ok: true };
}

export async function unsubscribe(actor: Session, endpoint: string) {
  if (!pushConfigured()) return { ok: true };
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: actor.userId } });
  return { ok: true };
}

/** Without keys push is off and the table is never read (so a database without it yet keeps working). */
export async function deviceCount(actor: Session) {
  if (!pushConfigured()) return { devices: 0 };
  return { devices: await db.pushSubscription.count({ where: { userId: actor.userId } }) };
}

type Sender = (sub: webpush.PushSubscription, payload: string) => Promise<unknown>;
let sender: Sender = (sub, payload) => {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 });
};
/** Tests inject a fake sender here. */
export function setPushSender(fake: Sender | null) {
  sender = fake ?? sender;
}

/**
 * Push the given notifications to their recipients' devices. Only rows that exist are sent, so a notification
 * from a transaction that rolled back never becomes an alert. Expired devices (404/410) are removed.
 */
export async function deliverPush(notificationIds: string[]): Promise<{ sent: number; removed: number }> {
  if (!notificationIds.length || !pushConfigured()) return { sent: 0, removed: 0 };
  const notes = await db.notification.findMany({ where: { id: { in: notificationIds } } });
  if (!notes.length) return { sent: 0, removed: 0 };
  const subs = await db.pushSubscription.findMany({ where: { userId: { in: [...new Set(notes.map((n) => n.userId))] } } });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    notes.flatMap((n) =>
      subs
        .filter((s) => s.userId === n.userId)
        .map(async (s) => {
          const payload = JSON.stringify({ title: n.title, body: n.body, url: n.link || "/dashboard", tag: n.id });
          try {
            await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
            sent++;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) gone.push(s.id);
            else console.error("[push] send failed", status ?? err);
          }
        }),
    ),
  );
  if (gone.length) await db.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  return { sent, removed: gone.length };
}

/**
 * Schedule deliverPush after the response, in the same company. `after` also runs when the request failed, which is
 * why deliverPush re-reads the rows. Outside a request (tests, scripts) there is nothing to schedule on: no push.
 */
export function queuePush(notificationIds: string[]) {
  if (!notificationIds.length || !pushConfigured()) return;
  const companyId = currentCompanyId();
  try {
    after(() => runInCompany(companyId, () => deliverPush(notificationIds)).catch((err) => console.error("[push]", err)));
  } catch {
    // not inside a request scope
  }
}
