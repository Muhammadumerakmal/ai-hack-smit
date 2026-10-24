"use client";

import { Avatar, cx, timeAgo } from "./primitives";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
}

/** Readable announcement feed: author avatar, name, relative time, title, body. `compact` clamps long posts. */
export function AnnouncementFeed({ items, compact }: { items: Announcement[]; compact?: boolean }) {
  return (
    <ol className={cx("relative", compact ? "space-y-4" : "space-y-3")}>
      {items.map((a) => (
        <li key={a.id} className={cx("flex gap-3", !compact && "rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5 dark:border-zinc-800/80 dark:bg-zinc-900/50")}>
          <Avatar name={a.authorName || "?"} />
          <article className="min-w-0 flex-1">
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{a.authorName || "—"}</span>
              <time dateTime={a.createdAt} className="text-[11px] text-zinc-500" title={new Date(a.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}>
                {timeAgo(a.createdAt)}
              </time>
            </header>
            <h3 className="mt-1 break-words text-sm font-semibold text-zinc-900 dark:text-zinc-50">{a.title}</h3>
            <p className={cx("mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-600 dark:text-zinc-300", compact && "line-clamp-3")}>{a.body}</p>
          </article>
        </li>
      ))}
    </ol>
  );
}
