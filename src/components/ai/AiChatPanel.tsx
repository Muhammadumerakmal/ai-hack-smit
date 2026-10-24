"use client";

import { useEffect, useRef, useState } from "react";
import { AiBadge } from "./AiBadge";
import { postAi } from "./api";

type Role = "ADMIN" | "HR" | "EMPLOYEE";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** assistant answers from the model carry the AI label; fallbacks and errors do not */
  ai?: boolean;
  error?: boolean;
}

const SUGGESTIONS: Record<Role, string[]> = {
  ADMIN: ["How many active employees are there?", "What was the payroll cost last month?", "Who is on leave today?"],
  HR: ["What is this month's attendance rate?", "Who came late most often this month?", "Who is on leave today?"],
  EMPLOYEE: ["How many sick leaves do I have left this year?", "How many times was I late this month?", "What time counts as late?"],
};

const HISTORY_SENT = 10;

export function AiChatPanel({ role, defaultOpen = false }: { role: Role; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setLoading(true);

    // Only real Q&A turns go back to the server; error bubbles stay local.
    const history = next.filter((m) => !m.error).slice(-HISTORY_SENT).map(({ role, content }) => ({ role, content }));
    const res = await postAi<{ answer: string }>("chat", { messages: history });

    setMessages((m) => [
      ...m,
      res.ok ? { role: "assistant", content: res.data.answer, ai: true } : { role: "assistant", content: res.message, error: true },
    ]);
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-violet-700"
      >
        <span aria-hidden>✦</span> Ask the assistant
      </button>
    );
  }

  return (
    <section
      aria-label="AI assistant"
      className="fixed inset-x-2 bottom-2 z-40 flex h-[min(560px,85vh)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <header className="flex items-center justify-between bg-violet-600 px-4 py-3 text-white">
        <div>
          <p className="text-sm font-semibold">HR Assistant</p>
          <p className="text-[11px] text-violet-100">Answers from your company data · {role.toLowerCase()} access</p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded p-1 text-lg leading-none hover:bg-violet-500">
          ×
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-zinc-500">Ask about attendance, leave, payroll or company policy. Try:</p>
            {SUGGESTIONS[role].map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-zinc-700 hover:border-violet-400 hover:bg-violet-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-violet-950"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-white">
              {m.content}
            </div>
          ) : (
            <div
              key={i}
              className={`mr-8 space-y-1 rounded-2xl rounded-bl-sm px-3 py-2 ${
                m.error ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.ai && <AiBadge />}
            </div>
          ),
        )}

        {loading && (
          <div className="mr-8 w-fit rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-zinc-500 dark:bg-zinc-900" aria-live="polite">
            Checking the records…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="Type your question…"
          aria-label="Your question"
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}
