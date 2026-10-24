"use client";

import { useState } from "react";
import { Button, Card, Loading, Notice, StatusBadge } from "@/components/ui";
import { api, fmtDate, fmtTime, useApi } from "@/lib/client";

interface Today {
  date: string;
  isWorkingDay: boolean;
  officeStart: string;
  graceMinutes: number;
  record: { checkIn: string; checkOut: string | null; status: string } | null;
}

/** Check in / check out for the signed-in employee. The server stamps the time. */
export function CheckInWidget({ onChange }: { onChange?: () => void }) {
  const { data, error, loading, reload } = useApi<Today>("/api/attendance/today");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function act(kind: "check-in" | "check-out") {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/attendance/${kind}`, { method: "POST", body: {} });
      setMsg({ tone: "success", text: kind === "check-in" ? "Checked in." : "Checked out." });
      reload();
      onChange?.();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Today's attendance">
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : data ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {fmtDate(data.date)} · office starts {data.officeStart} (late after {data.graceMinutes} min)
            {!data.isWorkingDay && " · not a working day"}
          </p>
          {data.record ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge status={data.record.status} />
              <span>In: {fmtTime(data.record.checkIn)}</span>
              <span>Out: {fmtTime(data.record.checkOut)}</span>
            </div>
          ) : (
            <p className="text-sm">You have not checked in yet.</p>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex gap-2">
            {!data.record && (
              <Button onClick={() => act("check-in")} loading={busy}>
                Check in
              </Button>
            )}
            {data.record && !data.record.checkOut && (
              <Button variant="secondary" onClick={() => act("check-out")} loading={busy}>
                Check out
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
