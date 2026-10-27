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
        <li key={a.id} className={cx("flex gap-3", !compact && "rounded-2xl glass p-4 sm:p-5")}>
          <Avatar name={a.authorName || "?"} />
          <article className="min-w-0 flex-1">
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{a.authorName || "—"}</span>
              <time dateTime={a.createdAt} className="text-[11px] text-zinc-500 dark:text-zinc-400" title={new Date(a.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}>
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
