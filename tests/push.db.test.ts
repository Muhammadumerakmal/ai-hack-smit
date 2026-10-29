import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as push from "@/app/api/push/route";
import { notify } from "@/lib/audit";
import { deliverPush, setPushSender } from "@/server/services/push.service";
import { call, hasDb, seed, sessionFor } from "./helpers";

// Web Push: devices subscribe through /api/push; every notification is pushed to the recipient's devices.
// A fake sender records what would go to the push service.

const device = (n: number) => ({ endpoint: `https://push.example.com/send/device-${n}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

describe.skipIf(!hasDb)("push alerts", () => {
  const db = new PrismaClient();
  let sara: Awaited<ReturnType<typeof sessionFor>>;
  let ali: Awaited<ReturnType<typeof sessionFor>>;
  let sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  let failWith: number | null = null;

  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY ||= "test-public-key";
    process.env.VAPID_PRIVATE_KEY ||= "test-private-key";
    await seed(db);
    [sara, ali] = await Promise.all([sessionFor(db, "sara@demo.test"), sessionFor(db, "ali@demo.test")]);
    setPushSender(async (sub, payload) => {
      if (failWith) throw Object.assign(new Error("push service"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
  });
  beforeEach(async () => {
    sent = [];
    failWith = null;
    await db.pushSubscription.deleteMany();
  });
  afterAll(() => db.$disconnect());

  it("a signed-in user turns alerts on for a device; GET reports it and the public key", async () => {
    expect((await call(push.POST, { userId: sara.userId, body: device(1) })).status).toBe(200);
    const info = await call(push.GET, { userId: sara.userId });
    expect(info.body).toMatchObject({ enabled: true, devices: 1 });
    expect(info.body.publicKey).toBeTruthy();
    expect(await db.pushSubscription.findFirstOrThrow()).toMatchObject({ userId: sara.userId, companyId: 1 });
  });

  it("rejects a non-https endpoint and anonymous callers", async () => {
    expect((await call(push.POST, { userId: sara.userId, body: { ...device(1), endpoint: "http://insecure.example.com/x" } })).status).toBe(400);
    expect((await call(push.POST, { body: device(1) })).status).toBe(401);
  });

  it("notifications are pushed to the recipient's devices only, with title, body and link", async () => {
    await call(push.POST, { userId: sara.userId, body: device(1) });
    await call(push.POST, { userId: sara.userId, body: device(2) });
    await call(push.POST, { userId: ali.userId, body: device(3) });
    await notify([sara.userId], { title: "Leave approved", body: "Your casual leave was approved.", link: "/leave" });
    const note = await db.notification.findFirstOrThrow({ where: { userId: sara.userId, title: "Leave approved" } });
    expect(await deliverPush([note.id])).toEqual({ sent: 2, removed: 0 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([device(1).endpoint, device(2).endpoint]);
    expect(sent[0].payload).toMatchObject({ title: "Leave approved", body: "Your casual leave was approved.", url: "/leave" });
  });

  it("never pushes a notification that doesn't exist (e.g. its transaction rolled back)", async () => {
    await call(push.POST, { userId: sara.userId, body: device(1) });
    expect(await deliverPush(["no-such-notification"])).toEqual({ sent: 0, removed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("removes devices the push service reports as gone (410)", async () => {
    await call(push.POST, { userId: sara.userId, body: device(1) });
    await notify([sara.userId], { title: "Payslip ready", body: "Your payslip is ready." });
    const note = await db.notification.findFirstOrThrow({ where: { title: "Payslip ready" } });
    failWith = 410;
    expect(await deliverPush([note.id])).toEqual({ sent: 0, removed: 1 });
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("turning alerts off removes only my device; the same device signing in as someone else is re-owned", async () => {
    await call(push.POST, { userId: sara.userId, body: device(1) });
    await call(push.DELETE, { userId: ali.userId, url: `/api/push?endpoint=${encodeURIComponent(device(1).endpoint)}` });
    expect(await db.pushSubscription.count()).toBe(1); // Ali can't remove Sara's device
    await call(push.POST, { userId: ali.userId, body: device(1) });
    expect(await db.pushSubscription.findFirstOrThrow()).toMatchObject({ userId: ali.userId });
    await call(push.DELETE, { userId: ali.userId, url: `/api/push?endpoint=${encodeURIComponent(device(1).endpoint)}` });
    expect(await db.pushSubscription.count()).toBe(0);
  });
});
