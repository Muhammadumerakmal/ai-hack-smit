import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIso, weekdayOf } from "@/lib/dates";
import type { Session } from "@/lib/session";
import { runChat, setChatModel } from "@/server/ai/chat";
import { guardedAiCall } from "@/server/ai/guard";
import { setLlm, type LlmClient, type LlmRequest, type LlmResponse } from "@/server/ai/llm";
import { runSmartLeave } from "@/server/ai/smart-leave";
import { runSummary } from "@/server/ai/summary";
import { runTool, toolDefsFor } from "@/server/ai/tools";
import { callTool, hangingModel, say, ScriptedModel } from "./ai-fake";
import { getDashboardKpis } from "@/server/services/analytics.service";
import { applyForLeave } from "@/server/services/leave.service";
import { seedDemo } from "../scripts/dev-seed";

// Needs the local Postgres from docker-compose (DATABASE_URL in .env). Skipped otherwise.
const hasDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");

/** A fake model that replays scripted replies and records what it was sent. */
class ScriptedLlm implements LlmClient {
  requests: LlmRequest[] = [];
  constructor(private steps: ((req: LlmRequest) => Partial<LlmResponse> | Promise<Partial<LlmResponse>>)[]) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone({ ...req, signal: undefined }) as unknown as LlmRequest);
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedLlm ran out of steps");
    return { content: null, toolCalls: [], model: "fake", ...(await step(req)) };
  }
}

describe.skipIf(!hasDb)("M8 against the database", () => {
  const db = new PrismaClient();
  let admin: Session, hr: Session, sara: Session, ali: Session;
  const signal = new AbortController().signal;

  beforeAll(async () => {
    await seedDemo(db);
    const users = await db.user.findMany({ include: { employee: true } });
    const s = (email: string): Session => {
      const u = users.find((x) => x.email === email)!;
      return { userId: u.id, role: u.role, employeeId: u.employee?.id ?? null, name: u.employee?.fullName ?? u.email };
    };
    admin = s("admin@demo.test");
    hr = s("hr@demo.test");
    sara = s("sara@demo.test");
    ali = s("ali@demo.test");
  });
  beforeEach(async () => {
    await db.aiLog.deleteMany();
    setLlm(null);
    setChatModel(null);
  });
  afterAll(async () => {
    setLlm(null);
    setChatModel(null);
    await db.$disconnect();
  });

  describe("role scoping in the tool layer", () => {
    it("never offers company-wide tools to an employee", () => {
      const names = toolDefsFor("EMPLOYEE").map((t) => t.name);
      expect(names).not.toContain("search_employees");
      expect(names).not.toContain("get_headcount");
      expect(names).not.toContain("get_late_comers");
      expect(toolDefsFor("HR").map((t) => t.name)).toContain("search_employees");
    });

    it("refuses a tool the employee was not given, even if the model calls it", async () => {
      const r = await runTool(sara, "search_employees", JSON.stringify({ query: "Ali" }));
      expect(r.ok).toBe(false);
      expect(JSON.parse(r.content).error).toBe("forbidden");
    });

    it("refuses an employee asking for a colleague's attendance or leave", async () => {
      for (const tool of ["get_attendance_summary", "get_leave_summary", "get_my_leave_balance"]) {
        const r = await runTool(sara, tool, JSON.stringify({ employee: "Ali Raza" }));
        expect(JSON.parse(r.content).error, tool).toBe("forbidden");
      }
    });

    it("gives an employee only their own payslip, with no company totals", async () => {
      const r = JSON.parse((await runTool(sara, "get_payroll_summary", "{}")).content);
      expect(r.scope).toBe("own");
      expect(r.gross).toBe(210000); // 1.5 × 140,000
      expect(r).not.toHaveProperty("totalGross");
    });

    it("rejects malformed arguments without crashing", async () => {
      const r = await runTool(hr, "get_attendance_summary", JSON.stringify({ start: "last week" }));
      expect(JSON.parse(r.content).error).toBe("invalid_arguments");
    });
  });

  describe("judge questions: same numbers as the dashboard", () => {
    const month = () => ({ start: `${todayIso().slice(0, 7)}-01`, end: todayIso() });

    it("HR: how many active employees are in Engineering?", async () => {
      const r = JSON.parse((await runTool(hr, "get_headcount", JSON.stringify({ department: "engineering" }))).content);
      expect(r.total).toBe(2);
    });

    it("HR: unknown department gets a helpful error listing real ones", async () => {
      const r = JSON.parse((await runTool(hr, "get_headcount", JSON.stringify({ department: "Marketing" }))).content);
      expect(r.message).toMatch(/Engineering/);
    });

    it("HR: who came late most often this month? matches the dashboard list", async () => {
      const tool = JSON.parse((await runTool(hr, "get_late_comers", "{}")).content);
      const kpis = await getDashboardKpis(hr, month());
      expect(tool.lateComers.map((l: { name: string }) => l.name)).toEqual(kpis.topLateComers.map((l) => l.name));
      if (tool.lateComers.length) expect(tool.lateComers[0].name).toBe("Ali Raza");
    });

    it("HR: this month's attendance rate matches the dashboard", async () => {
      const tool = JSON.parse((await runTool(hr, "get_attendance_summary", "{}")).content);
      const kpis = await getDashboardKpis(hr, month());
      expect(tool.attendanceRatePct).toBe(kpis.attendance.attendanceRatePct);
    });

    it("Employee: how many sick leaves do I have left? → own balance after approved leaves", async () => {
      const r = JSON.parse((await runTool(sara, "get_my_leave_balance", "{}")).content);
      const sick = r.balances.find((b: { type: string }) => b.type === "sick");
      expect(sick).toMatchObject({ quota: 8, usedApproved: 1, remaining: 7 });
    });
  });

  describe("chat loop", () => {
    it("calls a tool with the user's scope and answers from its result", async () => {
      const model = new ScriptedModel([callTool("get_my_leave_balance"), say("You have 7 sick leaves left this year.")]);
      setChatModel(model);
      const res = await guardedAiCall(sara, "chat", "sick leaves left?", (sig) =>
        runChat(sara, { messages: [{ role: "user", content: "How many sick leaves do I have left this year?" }] }, sig),
      );
      expect(res).toMatchObject({ ok: true, label: "AI-generated", data: { answer: "You have 7 sick leaves left this year." } });
      // The tool result the model saw is Sara's own balance.
      const toolMsg = model.requests[1].input.find((i) => i.type === "function_call_result") as { output: { text: string } } | undefined;
      expect(toolMsg && toolMsg.output.text).toContain('"remaining":7');
      // Employee requests never carry company-wide tools.
      const firstTools = model.requests[0].tools as Array<{ name: string }>;
      expect(firstTools.map((t) => t.name)).not.toContain("search_employees");

      const log = await db.aiLog.findFirstOrThrow({ where: { userId: sara.userId } });
      expect(log).toMatchObject({ feature: "chat", status: "ok", role: "EMPLOYEE" });
      expect(log.toolCalls).toEqual([{ name: "get_my_leave_balance", args: "{}", ok: true }]);
    });

    it("puts the policy rules in the system prompt", async () => {
      const model = new ScriptedModel([say("A check-in after 09:15 is late.")]);
      setChatModel(model);
      await runChat(ali, { messages: [{ role: "user", content: "What time counts as late?" }] }, signal);
      const system = model.requests[0].systemInstructions;
      expect(system).toContain("after 09:15 is late");
    });

    it("stops after a bounded number of tool rounds", async () => {
      const loop = Array.from({ length: 4 }, () => callTool("get_my_leave_balance"));
      const model = new ScriptedModel([...loop, say("Here is your balance.")]);
      setChatModel(model);
      const run = await runChat(sara, { messages: [{ role: "user", content: "balance" }] }, signal);
      expect(run.data.answer).toBe("Here is your balance.");
      // MAX_TOOL_ROUNDS tool rounds plus one final answer call, then the run stops.
      expect(model.requests).toHaveLength(5);
    });
  });

  describe("smart leave", () => {
    const nextMonday = () => {
      let d = addDays(todayIso(), 1);
      while (weekdayOf(d) !== 1) d = addDays(d, 1);
      return d;
    };

    it("turns a sentence into a pre-filled casual leave with correct dates, and saves nothing", async () => {
      const mon = nextMonday();
      const tue = addDays(mon, 1);
      setLlm(new ScriptedLlm([say(JSON.stringify({ type: "casual", start: mon, end: tue, reason: "Sister's wedding" }))]));
      const before = await db.leaveRequest.count();

      const res = await guardedAiCall(sara, "smart_leave", "wedding", (sig) =>
        runSmartLeave(sara, "I need next Monday and Tuesday off for my sister's wedding", sig),
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.draft).toEqual({ type: "casual", start: mon, end: tue, reason: "Sister's wedding" });
      expect(res.data.preview).toMatchObject({ workingDays: 2, remainingAfter: 8, blocking: [] });
      expect(await db.leaveRequest.count()).toBe(before);
    });

    it("retries once on invalid JSON, then succeeds", async () => {
      const mon = nextMonday();
      const llm = new ScriptedLlm([say("not json"), say(JSON.stringify({ type: "casual", start: mon, end: mon, reason: "Errand" }))]);
      setLlm(llm);
      const run = await runSmartLeave(sara, "next monday off", signal);
      expect(run.status).toBeUndefined();
      expect(run.data.draft?.start).toBe(mon);
      expect(llm.requests).toHaveLength(2);
    });

    it("falls back to the normal form after two bad answers", async () => {
      setLlm(new ScriptedLlm([say("{}"), say(JSON.stringify({ type: "holiday", start: "yesterday", end: "x", reason: "" }))]));
      const res = await guardedAiCall(sara, "smart_leave", "??", (sig) => runSmartLeave(sara, "some days off", sig));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("invalid_output");
      expect(res.data?.draft).toBeNull();
      expect(res.data?.leaveTypes.length).toBeGreaterThan(0); // the form can still render
      expect((await db.aiLog.findFirstOrThrow()).status).toBe("invalid_output");
    });

    it("rejects dates in the past", async () => {
      const past = addDays(todayIso(), -3);
      setLlm(new ScriptedLlm([say(JSON.stringify({ type: "sick", start: past, end: past, reason: "x" })), say("{}")]));
      const run = await runSmartLeave(sara, "off", signal);
      expect(run.status).toBe("invalid_output");
    });
  });

  describe("confirming the smart-leave draft (POST /api/leave-requests)", () => {
    const nextWeekday = (wd: number, from = todayIso()) => {
      let d = addDays(from, 1);
      while (weekdayOf(d) !== wd) d = addDays(d, 1);
      return d;
    };

    it("saves the confirmed draft as PENDING with working days counted", async () => {
      const mon = nextWeekday(1, addDays(todayIso(), 28));
      const r = await applyForLeave(sara, { type: "casual", start: mon, end: addDays(mon, 1), reason: "Sister's wedding" });
      expect(r).toMatchObject({ status: "PENDING", days: 2, type: "casual" });
    });

    it("rejects an overlapping request with 422", async () => {
      const mon = nextWeekday(1, addDays(todayIso(), 28));
      await expect(applyForLeave(sara, { type: "casual", start: mon, end: mon, reason: "again" })).rejects.toMatchObject({
        status: 422,
        message: expect.stringMatching(/already have a pending leave/),
      });
    });

    it("rejects a request over the remaining balance with 422", async () => {
      const start = nextWeekday(1, addDays(todayIso(), 60));
      await expect(applyForLeave(sara, { type: "sick", start, end: addDays(start, 18), reason: "long" })).rejects.toMatchObject({
        status: 422,
        // The range may cross a year boundary, where the service names the year ("… for 2027: …").
        message: expect.stringMatching(/Not enough Sick balance( for \d{4})?: \d+ left/),
      });
    });

    it("does not let Admin apply (no employee record)", async () => {
      await expect(applyForLeave(admin, { type: "casual", start: "2099-01-05", end: "2099-01-05", reason: "x" })).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("dashboard summary", () => {
    it("rejects bullets with numbers that are not in the KPI JSON, then accepts grounded ones", async () => {
      const llm = new ScriptedLlm([
        say(JSON.stringify({ bullets: ["Attendance is up 37% on last month.", "All good.", "Fine."] })),
        say(JSON.stringify({ bullets: ["Headcount is 5.", "Ali Raza is the most frequent late-comer.", "There is 1 pending leave approval."] })),
      ]);
      setLlm(llm);
      const run = await runSummary(hr, {}, signal);
      expect(run.status).toBeUndefined();
      expect(run.data.bullets[0]).toBe("Headcount is 5.");
      const feedback = llm.requests[1].messages.at(-1);
      expect(feedback && "content" in feedback && feedback.content).toMatch(/37/);
    });

    it("is not available to employees", async () => {
      await expect(runSummary(sara, {}, signal)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("guardrails", () => {
    it("times out with a friendly fallback and logs it", async () => {
      setChatModel(hangingModel());
      const res = await guardedAiCall(hr, "chat", "slow", (sig) => runChat(hr, { messages: [{ role: "user", content: "hi" }] }, sig));
      expect(res).toMatchObject({ ok: false, reason: "timeout" });
      expect((await db.aiLog.findFirstOrThrow()).status).toBe("timeout");
    });

    it("rate limits at 20 calls per user per hour", async () => {
      await db.aiLog.createMany({
        data: Array.from({ length: 20 }, () => ({ userId: ali.userId, role: "EMPLOYEE" as const, feature: "chat", input: "x", status: "ok", latencyMs: 1 })),
      });
      setChatModel(new ScriptedModel([say("should not be called")]));
      await expect(
        guardedAiCall(ali, "chat", "one more", (sig) => runChat(ali, { messages: [{ role: "user", content: "hi" }] }, sig)),
      ).rejects.toMatchObject({ status: 429 });
      // Other users are unaffected.
      setChatModel(new ScriptedModel([say("hello")]));
      const ok = await guardedAiCall(admin, "chat", "hi", (sig) => runChat(admin, { messages: [{ role: "user", content: "hi" }] }, sig));
      expect(ok.ok).toBe(true);
    });

    it("blocks deactivated accounts even with a valid token", async () => {
      await db.user.update({ where: { id: ali.userId }, data: { isActive: false } });
      try {
        await expect(guardedAiCall(ali, "chat", "hi", async () => ({ data: null, output: "" }))).rejects.toMatchObject({ status: 401 });
      } finally {
        await db.user.update({ where: { id: ali.userId }, data: { isActive: true } });
      }
    });
  });
});
