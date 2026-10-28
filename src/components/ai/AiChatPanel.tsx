"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AiBadge } from "./AiBadge";
import { postAi } from "./api";

type Role = "ADMIN" | "HR" | "EMPLOYEE";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** when it was sent or received (ms), shown as hh:mm */
  at: number;
  /** assistant answers from the model carry the AI label; fallbacks and errors do not */
  ai?: boolean;
  error?: boolean;
  /** the user pressed Stop while waiting */
  stopped?: boolean;
  /** the question an error/stopped answer belongs to, so "Try again" can resend it */
  retry?: string;
  /** the question an AI answer belongs to, so "Regenerate" can ask it again */
  question?: string;
  /** which records the answer was read from ("Headcount", "Payroll"…); names only */
  sources?: string[];
}

/** Plain text for the clipboard: the answer without its **bold** markers. */
const plain = (md: string) => md.replace(/\*\*/g, "");
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const MAX_CHARS = 2000;

type TopicIcon = "people" | "clock" | "calendar" | "wallet" | "book";
interface Topic {
  icon: TopicIcon;
  title: string;
  question: string;
}

// Starting points per role: one question each, all answerable from that role's own data.
const TOPICS: Record<Role, Topic[]> = {
  ADMIN: [
    { icon: "people", title: "Headcount", question: "How many active employees are in each department?" },
    { icon: "wallet", title: "Payroll", question: "What was the payroll cost last month?" },
    { icon: "calendar", title: "Leave", question: "Who is on leave this week?" },
    { icon: "book", title: "Policy", question: "How is monthly income tax calculated?" },
  ],
  HR: [
    { icon: "clock", title: "Attendance", question: "What is this month's attendance rate?" },
    { icon: "people", title: "Late arrivals", question: "Who came late most often this month?" },
    { icon: "calendar", title: "Leave", question: "Who is on leave this week?" },
    { icon: "book", title: "Policy", question: "What counts as a half day?" },
  ],
  EMPLOYEE: [
    { icon: "calendar", title: "My leave", question: "How many sick leaves do I have left this year?" },
    { icon: "clock", title: "My attendance", question: "How many times was I late this month?" },
    { icon: "wallet", title: "My pay", question: "What was my net pay on my last payslip?" },
    { icon: "book", title: "Policy", question: "What time counts as late?" },
  ],
};

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", HR: "HR", EMPLOYEE: "Employee" };
const SCOPE: Record<Role, string> = {
  ADMIN: "all of your company's records",
  HR: "HR records for every employee",
  EMPLOYEE: "your own records and company policy",
};

export function AiChatPanel({ role, name, company, defaultOpen = false }: { role: Role; name?: string; company?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // Compact floating window, or a full-height side panel for longer answers (desktop; phones are always full screen).
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // The server keeps the conversation; the reply returns the id to send with the next question.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Seconds since the question was sent: answers can take a while when the AI provider is busy.
  const [elapsed, setElapsed] = useState(0);
  // One live region for screen readers: the status, then the answer (never the user's own question again).
  const [announcement, setAnnouncement] = useState("");
  // "New chat" asks first: it clears the conversation (ui-ux-pro-max: confirm destructive actions).
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  // Reading older messages: a new answer shows a "New answer" button instead of yanking the scroll.
  const [unseen, setUnseen] = useState(false);
  const nearBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup function.
  useEffect(() => {
    if (nearBottom.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, open, expanded]);

  useEffect(() => {
    if (!loading) return;
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    const slow = setTimeout(() => setAnnouncement("Still checking the records…"), 8000);
    return () => {
      clearInterval(tick);
      clearTimeout(slow);
    };
  }, [loading]);

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

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom.current) setUnseen(false);
  }

  function jumpToLatest() {
    nearBottom.current = true;
    setUnseen(false);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  function newChat() {
    if (loading) return;
    setConfirmClear(false);
    setMessages([]);
    setConversationId(null);
    setInput("");
    setUnseen(false);
    nearBottom.current = true;
    setAnnouncement("Started a new chat.");
    inputRef.current?.focus();
  }

  async function copy(index: number) {
    try {
      await navigator.clipboard.writeText(plain(messages[index].content));
      setCopied(index);
      setAnnouncement("Answer copied.");
      setTimeout(() => setCopied((c) => (c === index ? null : c)), 2000);
    } catch {
      setAnnouncement("Copying is blocked in this browser.");
    }
  }

  /** Ask the same question again: the previous answer (or failure) is replaced, not kept twice. */
  function askAgain(index: number, question: string | undefined) {
    if (!question || loading) return;
    setMessages((m) => m.slice(0, Math.max(0, index - 1)));
    void send(question);
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: "user", content: question, at: Date.now() }]);
    setInput("");
    setElapsed(0);
    setLoading(true);
    setAnnouncement("Checking the records…");

    // Only the new question goes to the server; earlier turns live in its history.
    nearBottom.current = true; // asking a question always follows the conversation down
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await postAi<{ answer: string; conversationId: string; sources?: string[] }>(
      "chat",
      conversationId ? { conversationId, message: question } : { message: question },
      controller.signal,
    );
    abortRef.current = null;
    if (res.ok && !conversationId) setConversationId(res.data.conversationId);

    const stopped = !res.ok && res.reason === "aborted";
    setMessages((m) => [
      ...m,
      res.ok
        ? { role: "assistant", content: res.data.answer, at: Date.now(), ai: true, question, sources: res.data.sources ?? [] }
        : { role: "assistant", content: res.message, at: Date.now(), error: !stopped, stopped, retry: question },
    ]);
    // Scrolled up to read while waiting: offer a jump instead of moving the page.
    if (!nearBottom.current) setUnseen(true);
    setAnnouncement(res.ok ? `Assistant: ${plain(res.data.answer)}` : stopped ? "Stopped." : `Assistant could not answer: ${res.message}`);
    setLoading(false);
    if (stopped) inputRef.current?.focus();
  }

  if (!open) {
    return (
      <button
        ref={launcherRef}
        onClick={() => setOpen(true)}
        aria-label="Ask the assistant"
        title="Ask the assistant"
        className="group fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center gap-2 rounded-full bg-violet-600 text-sm font-medium text-white glass-gloss ring-1 ring-white/15 transition hover:-translate-y-0.5 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 sm:h-auto sm:w-auto sm:py-3 sm:pl-3.5 sm:pr-4"
      >
        <SparkIcon className="h-5 w-5 transition-transform group-hover:rotate-12 sm:h-4 sm:w-4" />
        <span className="hidden sm:inline">Ask the assistant</span>
      </button>
    );
  }

  const nearLimit = input.length > MAX_CHARS - 400;
  // Long answers stay readable in the wide panel: about 70 characters per line (ui-ux-pro-max: line length).
  const measure = expanded ? "sm:max-w-[68ch]" : "";

  return (
    <section
      role="dialog"
      aria-label="AI assistant"
      onKeyDown={(e) => e.key === "Escape" && close()}
      className={`fixed inset-0 z-40 flex animate-rise flex-col overflow-hidden glass-strong shadow-2xl shadow-zinc-950/25 [animation-duration:300ms] sm:inset-auto sm:right-4 sm:bottom-4 sm:rounded-2xl ${
        expanded ? "sm:top-20 sm:w-[min(680px,calc(100vw-2rem))]" : "sm:h-[min(660px,calc(100vh-6rem))] sm:w-[420px]"
      }`}
    >
      {/* Calm header: violet only as an accent (minimal chrome) */}
      <header className="flex items-center gap-3 border-b border-zinc-200/70 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-zinc-900/50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white glass-gloss">
          <SparkIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-50">HR Assistant</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            {company ? `${company} · ` : ""}
            {ROLE_LABEL[role]} access
          </p>
        </div>
        {messages.length > 0 && (
          <HeaderButton label="Start a new chat" title="New chat" onClick={() => setConfirmClear(true)} disabled={loading}>
            <path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </HeaderButton>
        )}
        <HeaderButton
          label={expanded ? "Make the assistant smaller" : "Expand the assistant"}
          title={expanded ? "Smaller" : "Expand"}
          onClick={() => setExpanded((x) => !x)}
          className="hidden sm:flex"
        >
          {expanded ? <path d="M9 4v5H4M15 20v-5h5M4 9l5-5M20 15l-5 5" /> : <path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6" />}
        </HeaderButton>
        <HeaderButton label="Close assistant" title="Close (Esc)" onClick={close}>
          <path d="M6 6l12 12M18 6 6 18" />
        </HeaderButton>
      </header>

      {confirmClear && (
        <div role="alertdialog" aria-label="Start a new chat?" className="flex items-center gap-2 border-b border-violet-200/70 bg-violet-50/90 px-4 py-2.5 text-xs text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/60 dark:text-violet-100">
          <span className="flex-1">Start a new chat? This clears the conversation.</span>
          <button onClick={() => setConfirmClear(false)} autoFocus className="h-7 rounded-md px-2.5 font-medium text-violet-800 hover:bg-violet-100 dark:text-violet-200 dark:hover:bg-violet-900/50">
            Keep
          </button>
          <button onClick={newChat} className="h-7 rounded-md bg-violet-600 px-2.5 font-medium text-white hover:bg-violet-700">
            Clear
          </button>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-4 py-5 text-sm sm:px-5">
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {messages.length === 0 && (
          <div className={`mx-auto flex flex-col ${expanded ? "max-w-xl" : ""}`}>
            <p className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {name ? `Hi ${name.split(/\s+/)[0]}, what would you like to know?` : "What would you like to know?"}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Answers come only from {SCOPE[role]}. The assistant reads records but can never change them.
            </p>
            <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">Start with a topic</p>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              {TOPICS[role].map((t) => (
                <button
                  key={t.title}
                  onClick={() => send(t.question)}
                  className="group flex flex-col gap-2 rounded-xl border border-white/70 bg-white/65 p-3 text-left shadow-sm shadow-zinc-900/5 transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-white/90 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:border-violet-800 dark:hover:bg-white/10"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                      <TopicGlyph name={t.icon} />
                    </span>
                    <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{t.title}</span>
                  </span>
                  <span className="text-xs leading-snug text-zinc-600 group-hover:text-violet-900 dark:text-zinc-300 dark:group-hover:text-violet-200">{t.question}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`space-y-5 ${expanded ? "mx-auto max-w-3xl" : ""}`}>
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2 text-white shadow-sm shadow-violet-900/10">
                  {m.content}
                </div>
                <time className="pr-1 text-[11px] text-zinc-500 dark:text-zinc-400">{clock(m.at)}</time>
              </div>
            ) : (
              <article key={i} aria-label="Assistant answer" className="flex animate-rise items-start gap-2.5 [animation-duration:350ms]">
                <AssistantAvatar tone={m.error ? "error" : m.stopped ? "muted" : "ai"} />
                <div className={`min-w-0 flex-1 space-y-2 ${measure}`}>
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200">Assistant</span>
                    <span aria-hidden>·</span>
                    <time>{clock(m.at)}</time>
                  </p>
                  <div
                    className={`break-words rounded-2xl rounded-tl-md px-4 py-3 leading-relaxed ${
                      m.error
                        ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200"
                        : m.stopped
                          ? "border border-dashed border-zinc-300 bg-white/50 text-zinc-600 dark:border-zinc-700 dark:bg-white/5 dark:text-zinc-300"
                          : "glass text-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    {m.error || m.stopped ? <p>{m.content}</p> : <RichText text={m.content} />}
                  </div>
                  {!!m.sources?.length && (
                    // Context card: which records the answer came from (names only).
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-medium text-zinc-600 dark:text-zinc-300">Checked</span>
                      {m.sources.map((s) => (
                        <span key={s} className="rounded-md border border-violet-200 bg-violet-50/80 px-1.5 py-0.5 text-violet-800 dark:border-violet-900/60 dark:bg-violet-500/10 dark:text-violet-200">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {m.ai && <AiBadge />}
                    {m.ai && (
                      <ActionButton onClick={() => copy(i)} icon={copied === i ? <CheckIcon /> : <CopyIcon />}>
                        {copied === i ? "Copied" : "Copy"}
                      </ActionButton>
                    )}
                    {m.ai && i === messages.length - 1 && m.question && (
                      <ActionButton onClick={() => askAgain(i, m.question)} disabled={loading} icon={<RegenerateIcon />}>
                        Regenerate
                      </ActionButton>
                    )}
                    {(m.error || m.stopped) && m.retry && i === messages.length - 1 && (
                      <ActionButton onClick={() => askAgain(i, m.retry)} disabled={loading} icon={<RegenerateIcon />}>
                        {m.stopped ? "Ask again" : "Try again"}
                      </ActionButton>
                    )}
                  </div>
                </div>
              </article>
            ),
          )}

          {loading && (
            <div className="flex items-start gap-2.5" aria-hidden>
              <AssistantAvatar tone="ai" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">Assistant</p>
                <div className="inline-flex flex-col gap-1 rounded-2xl rounded-tl-md glass px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
                  <span className="flex items-center gap-2.5">
                    <span className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                    Checking the records{elapsed >= 3 ? ` · ${elapsed} s` : "…"}
                  </span>
                  {elapsed >= 8 && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">The AI service is busy; answers can take up to 45 s. You can stop and ask later.</span>}
                </div>
              </div>
            </div>
          )}
        </div>
        <div ref={endRef} />
        {unseen && (
          <button
            onClick={jumpToLatest}
            className="sticky bottom-0 left-1/2 mt-2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-violet-900/25 hover:bg-violet-700"
          >
            New answer
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-zinc-200/70 bg-white/50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-white/10 dark:bg-zinc-950/30"
      >
        <div className={`flex items-end gap-2 rounded-xl glass-control py-1.5 pl-3 pr-1.5 transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/15 ${expanded ? "sm:mx-auto sm:max-w-3xl" : ""}`}>
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
            maxLength={MAX_CHARS}
            placeholder="Ask about attendance, leave, pay or policy…"
            aria-label="Your question"
            className="max-h-[132px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 outline-none focus-visible:outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
          {loading ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop waiting for the answer"
              title="Stop"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              title="Send (Enter)"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition hover:bg-violet-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className={`mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400 ${expanded ? "sm:mx-auto sm:max-w-3xl" : ""}`}>
          <span>Enter to send · Shift+Enter for a new line · Check important numbers on the dashboard.</span>
          {nearLimit && (
            <span className={`shrink-0 tabular-nums ${input.length >= MAX_CHARS ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>
              {input.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
          )}
        </p>
      </form>
    </section>
  );
}

function HeaderButton({
  label,
  title,
  onClick,
  disabled,
  className = "flex",
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={`${className} h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-50`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function ActionButton({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
    >
      {icon}
      {children}
    </button>
  );
}

const TOPIC_PATHS: Record<TopicIcon, string> = {
  people: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.2a3 3 0 0 0-2.2-2.9M15.5 5.2a3 3 0 0 1 0 5.6",
  clock: "M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17M12 8v4.5l3 2",
  calendar: "M7 4v3M17 4v3M4.5 10h15M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6",
  wallet: "M3.5 8h17v10.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM8.5 8V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v2M3.5 13h17",
  book: "M5 4.5h9a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3zM5 16.5a3 3 0 0 1 3-3h9M9 8h4",
};

function TopicGlyph({ name }: { name: TopicIcon }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={TOPIC_PATHS[name]} />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2.5c.4 0 .7.3.8.6l1.2 4.1a4 4 0 0 0 2.8 2.8l4.1 1.2a.8.8 0 0 1 0 1.6l-4.1 1.2a4 4 0 0 0-2.8 2.8l-1.2 4.1a.8.8 0 0 1-1.6 0l-1.2-4.1a4 4 0 0 0-2.8-2.8l-4.1-1.2a.8.8 0 0 1 0-1.6l4.1-1.2a4 4 0 0 0 2.8-2.8l1.2-4.1c.1-.3.4-.6.8-.6Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  );
}

function AssistantAvatar({ tone }: { tone: "ai" | "error" | "muted" }) {
  const cls = {
    ai: "bg-violet-600 text-white glass-gloss",
    error: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    muted: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  }[tone];
  return (
    <span aria-hidden className={`mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls}`}>
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
