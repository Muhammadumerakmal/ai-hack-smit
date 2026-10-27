"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AiBadge } from "./AiBadge";
import { postAi } from "./api";

type Role = "ADMIN" | "HR" | "EMPLOYEE";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** assistant answers from the model carry the AI label; fallbacks and errors do not */
  ai?: boolean;
  error?: boolean;
  /** the question an error answer belongs to, so "Try again" can resend it */
  retry?: string;
}

const SUGGESTIONS: Record<Role, string[]> = {
  ADMIN: ["How many active employees are there?", "What was the payroll cost last month?", "Who is on leave today?"],
  HR: ["What is this month's attendance rate?", "Who came late most often this month?", "Who is on leave today?"],
  EMPLOYEE: ["How many sick leaves do I have left this year?", "How many times was I late this month?", "What time counts as late?"],
};

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", HR: "HR", EMPLOYEE: "Employee" };
const SCOPE: Record<Role, string> = {
  ADMIN: "all company data",
  HR: "HR data for every employee",
  EMPLOYEE: "your own records and company policy",
};

export function AiChatPanel({ role, name, defaultOpen = false }: { role: Role; name?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<Message[]>([]);
  // The server keeps the conversation; the reply returns the id to send with the next question.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Grow the box with its text, up to about five lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input, open]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  function newChat() {
    if (loading) return;
    setMessages([]);
    setConversationId(null);
    setInput("");
    inputRef.current?.focus();
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    // Only the new question goes to the server; earlier turns live in its history.
    const res = await postAi<{ answer: string; conversationId: string }>(
      "chat",
      conversationId ? { conversationId, message: question } : { message: question },
    );
    if (res.ok && !conversationId) setConversationId(res.data.conversationId);

    setMessages((m) => [
      ...m,
      res.ok ? { role: "assistant", content: res.data.answer, ai: true } : { role: "assistant", content: res.message, error: true, retry: question },
    ]);
    setLoading(false);
  }

  /** Resend a failed question: drop the failed pair first so it is not shown twice. */
  function retry(index: number) {
    const question = messages[index]?.retry;
    if (!question || loading) return;
    setMessages((m) => m.slice(0, Math.max(0, index - 1)));
    void send(question);
  }

  if (!open) {
    return (
      <button
        ref={launcherRef}
        onClick={() => setOpen(true)}
        aria-label="Ask the assistant"
        title="Ask the assistant"
        className="group fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-sm font-medium text-white shadow-lg shadow-violet-900/25 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 sm:h-auto sm:w-auto sm:py-3 sm:pl-3.5 sm:pr-4"
      >
        <SparkIcon className="h-5 w-5 transition-transform group-hover:rotate-12 sm:h-4 sm:w-4" />
        <span className="hidden sm:inline">Ask the assistant</span>
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="AI assistant"
      onKeyDown={(e) => e.key === "Escape" && close()}
      className="fixed inset-x-2 bottom-2 top-16 z-40 flex animate-rise flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-auto sm:h-[min(620px,calc(100vh-6rem))] sm:w-[400px] dark:border-zinc-800 dark:bg-zinc-950"
    >
      <header className="relative flex items-center gap-3 overflow-hidden bg-gradient-to-br from-violet-600 via-violet-600 to-indigo-600 px-4 py-3.5 text-white">
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
          <SparkIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="relative min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">HR Assistant</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-violet-100">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" aria-hidden />
            {ROLE_LABEL[role]} access · answers from your records
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={newChat}
            disabled={loading}
            aria-label="Start a new chat"
            title="New chat"
            className="relative rounded-lg p-1.5 text-violet-100 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        )}
        <button onClick={close} aria-label="Close assistant" title="Close (Esc)" className="relative rounded-lg p-1.5 text-violet-100 transition hover:bg-white/15 hover:text-white">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto bg-zinc-50/70 px-4 py-4 text-sm dark:bg-zinc-950" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col">
            <div className="flex flex-col items-center px-2 pb-5 pt-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-700 ring-1 ring-violet-200 dark:from-violet-950 dark:to-indigo-950 dark:text-violet-300 dark:ring-violet-900">
                <SparkIcon className="h-6 w-6" />
              </span>
              <p className="mt-3 text-base font-semibold tracking-tight">{name ? `Hi ${name.split(/\s+/)[0]}, how can I help?` : "How can I help?"}</p>
              <p className="mt-1 max-w-[18rem] text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                I answer questions about attendance, leave, payroll and policy from {SCOPE[role]}. I can&apos;t change anything.
              </p>
            </div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">Try asking</p>
            <div className="space-y-2">
              {SUGGESTIONS[role].map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="group flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-left text-zinc-700 shadow-sm shadow-zinc-900/5 transition hover:border-violet-300 hover:bg-violet-50/60 hover:text-violet-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
                >
                  <span>{s}</span>
                  <span aria-hidden className="text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-violet-500 dark:text-zinc-600">→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-violet-600 to-indigo-600 px-3.5 py-2 text-white shadow-sm shadow-violet-900/10">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2">
                <AssistantAvatar error={m.error} />
                <div className="min-w-0 max-w-[85%] space-y-2">
                  <div
                    className={`break-words rounded-2xl rounded-tl-md px-3.5 py-2.5 leading-relaxed ${
                      m.error
                        ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200"
                        : "border border-zinc-200/80 bg-white text-zinc-800 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {m.error ? <p>{m.content}</p> : <RichText text={m.content} />}
                  </div>
                  <div className="flex items-center gap-2 pl-1">
                    {m.ai && <AiBadge />}
                    {m.error && m.retry && i === messages.length - 1 && (
                      <button onClick={() => retry(i)} disabled={loading} className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-50 dark:text-violet-300">
                        Try again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}

          {loading && (
            <div className="flex items-start gap-2" role="status">
              <AssistantAvatar />
              <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-md border border-zinc-200/80 bg-white px-3.5 py-3 text-xs text-zinc-500 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <span className="flex gap-1" aria-hidden>
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </span>
                Checking the records…
              </div>
            </div>
          )}
        </div>
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-end gap-2 rounded-xl border border-zinc-300 bg-white py-1.5 pl-3 pr-1.5 shadow-sm shadow-zinc-900/5 transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/15 dark:border-zinc-700 dark:bg-zinc-900">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line (and IME composition is left alone).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            maxLength={2000}
            placeholder="Ask about attendance, leave or pay…"
            aria-label="Your question"
            className="max-h-[132px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 outline-none focus-visible:outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition hover:bg-violet-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          Enter to send · Shift+Enter for a new line · AI answers can be wrong, so check important numbers on the dashboard.
        </p>
      </form>
    </section>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2.5c.4 0 .7.3.8.6l1.2 4.1a4 4 0 0 0 2.8 2.8l4.1 1.2a.8.8 0 0 1 0 1.6l-4.1 1.2a4 4 0 0 0-2.8 2.8l-1.2 4.1a.8.8 0 0 1-1.6 0l-1.2-4.1a4 4 0 0 0-2.8-2.8l-4.1-1.2a.8.8 0 0 1 0-1.6l4.1-1.2a4 4 0 0 0 2.8-2.8l1.2-4.1c.1-.3.4-.6.8-.6Z" />
    </svg>
  );
}

function AssistantAvatar({ error }: { error?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
        error ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-gradient-to-br from-violet-600 to-indigo-600 text-white"
      }`}
    >
      <SparkIcon className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * The small Markdown subset the model uses in short answers: paragraphs, "-"/"*"/"•" and "1." lists,
 * "#" headings and **bold**. Built as React elements (never HTML), so a reply can't inject markup.
 */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5 marker:text-zinc-400">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="list-disc space-y-1 pl-5 marker:text-violet-400">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1])}
        </p>,
      );
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}

/** **bold** spans inside a line; everything else stays plain text. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? (
      <strong key={i} className="font-semibold text-zinc-950 dark:text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
