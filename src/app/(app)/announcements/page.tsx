"use client";

import { useState } from "react";
import { AnnouncementFeed, type Announcement } from "@/components/dashboard/AnnouncementFeed";
import { cx, DIcon, Skeleton } from "@/components/dashboard/primitives";
import { useMe } from "@/components/shell/AppShell";
import { Button, EmptyState, ErrorState, Field, FieldErrors, Input, Notice, Textarea } from "@/components/ui";
import { api, fieldErrorsOf, useApi } from "@/lib/client";

const TITLE_MAX = 120;
const BODY_MAX = 2000;

export default function AnnouncementsPage() {
  const me = useMe();
  const canPost = me.role === "ADMIN" || me.role === "HR";
  const { data, error, loading, reload } = useApi<{ items: Announcement[] }>("/api/announcements?limit=50");
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [composerOpen, setComposerOpen] = useState(false);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setFieldErrs({});
    try {
      const r = await api<{ notified: number }>("/api/announcements", { body: form });
      setForm({ title: "", body: "" });
      setMsg({ tone: "success", text: `Posted. ${r.notified} ${r.notified === 1 ? "person was" : "people were"} notified.` });
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
      setFieldErrs(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  }

  const count = data?.items.length ?? 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.7rem]">Announcements</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Company news, shown on every dashboard{data ? ` · ${count} ${count === 1 ? "post" : "posts"}` : ""}.
          </p>
        </div>
        {canPost && (
          <Button className="lg:hidden" onClick={() => setComposerOpen((o) => !o)} aria-expanded={composerOpen}>
            <DIcon name="megaphone" />
            {composerOpen ? "Close" : "New announcement"}
          </Button>
        )}
      </div>

      <div className={cx("grid gap-6", canPost && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <section aria-label="Announcements feed" className="order-2 min-w-0 space-y-3 lg:order-1">
          {error && <ErrorState message={error} onRetry={reload} />}
          {loading && !data && (
            <div className="space-y-3" role="status" aria-label="Loading announcements">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 rounded-2xl glass p-5">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {data && !count && (
            <EmptyState title="No announcements yet" hint={canPost ? "Share the first update with everyone using the form." : "Company news from Admin and HR will appear here."} />
          )}
          {data && count > 0 && <AnnouncementFeed items={data.items} />}
        </section>

        {canPost && (
          <aside className={cx("order-1 lg:order-2 lg:block", composerOpen ? "block" : "hidden")}>
            <div className="rounded-2xl glass p-5 lg:sticky lg:top-24">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  <DIcon name="megaphone" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Post an announcement</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Everyone gets an in-app notification.</p>
                </div>
              </div>
              <FieldErrors errors={fieldErrs}>
              <form onSubmit={post} className="space-y-4">
                {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
                <Field name="title" label="Title" hint={`${form.title.length}/${TITLE_MAX}`}>
                  <Input
                    required
                    minLength={3}
                    maxLength={TITLE_MAX}
                    value={form.title}
                    placeholder="e.g. Office closed on Friday"
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </Field>
                <Field name="body" label="Message" hint={`${form.body.length}/${BODY_MAX}`}>
                  <Textarea
                    required
                    rows={6}
                    maxLength={BODY_MAX}
                    value={form.body}
                    placeholder="Write the details people need to know."
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                  />
                </Field>
                <Button type="submit" loading={busy} className="w-full">
                  Post to everyone
                </Button>
              </form>
              </FieldErrors>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
