import { readJson, searchParams, withSession } from "@/lib/api";
import { z } from "zod";
import { deviceCount, publicKey, subscribe, subscriptionSchema, unsubscribe } from "@/server/services/push.service";

// GET    /api/push → { enabled, publicKey, devices }  (whether push is set up, the key to subscribe with, my devices)
// POST   /api/push { endpoint, keys: { p256dh, auth } } → save this device for push alerts
// DELETE /api/push?endpoint=… → stop alerts on this device
// allowPasswordChange: turning alerts on/off is harmless before the first password change.
export const GET = withSession(async (_req, s) => ({ ...publicKey(), ...(await deviceCount(s)) }), { allowPasswordChange: true });

export const POST = withSession(async (req, s) => subscribe(s, await readJson(req, subscriptionSchema)), { allowPasswordChange: true });

export const DELETE = withSession(
  async (req, s) => unsubscribe(s, z.url().parse(searchParams(req).get("endpoint"))),
  { allowPasswordChange: true },
);
