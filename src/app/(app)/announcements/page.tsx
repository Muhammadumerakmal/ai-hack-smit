"use client";

import { useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, Textarea } from "@/components/ui";
import { api, fmtDateTime, useApi } from "@/lib/client";

interface Announcement {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export default function AnnouncementsPage() {
  const me = useMe();
  const canPost = me.role === "ADMIN" || me.role === "HR";
  const { data, error, loading, reload } = useApi<{ items: Announcement[] }>("/api/announcements?limit=50");
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ notified: number }>("/api/announcements", { body: form });
      setForm({ title: "", body: "" });
      setMsg({ tone: "success", text: `Posted. ${r.notified} people were notified.` });
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Announcements" subtitle="Shown on every dashboard." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          {error && <ErrorState message={error} onRetry={reload} />}
          {loading && !data && <Loading />}
          {data && !data.items.length && <EmptyState title="No announcements yet" hint={canPost ? "Post the first one with the form." : undefined} />}
          {data?.items.map((a) => (
            <Card key={a.id}>
              <p className="font-medium">{a.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{a.body}</p>
              <p className="mt-2 text-xs text-zinc-500">
                {a.authorName} · {fmtDateTime(a.createdAt)}
              </p>
            </Card>
          ))}
        </div>
        {canPost && (
          <Card title="Post an announcement">
            <form onSubmit={post} className="space-y-3">
              {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              <Field label="Title">
                <Input required minLength={3} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Message">
                <Textarea required rows={5} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </Field>
              <Button type="submit" loading={busy} className="w-full">
                Post to everyone
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
