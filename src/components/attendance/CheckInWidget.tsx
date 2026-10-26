"use client";

import { useEffect, useState } from "react";
import { addClock, COMPANY_TZ, fmtDuration, minutesBetween } from "@/components/ops/format";
import Link from "next/link";
import { OpsIcon } from "@/components/ops/icons";
import { cx, Skeleton, StatusPill } from "@/components/ops/primitives";
import { Button, Notice } from "@/components/ui";
import { api, fmtTime, useApi } from "@/lib/client";
import { CameraCheckIn } from "./CameraCheckIn";

interface Today {
  date: string;
  isWorkingDay: boolean;
  officeStart: string;
  graceMinutes: number;
  halfDayHours?: number;
  camera?: { available: boolean; required: boolean; radiusMeters: number; maxAccuracyMeters: number; faceEnrolled?: boolean };
  record: { checkIn: string; checkOut: string | null; status: string; source?: string; distanceMeters?: number | null } | null;
}

/** Live wall clock in company time; ticks every second. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: COMPANY_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: COMPANY_TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Check in / check out for the signed-in employee. The server stamps the time. */
export function CheckInWidget({ onChange }: { onChange?: () => void }) {
  const { data, error, loading, reload } = useApi<Today>("/api/attendance/today");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const now = useNow();

  async function act(kind: "check-in" | "check-out") {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/attendance/${kind}`, { method: "POST", body: {} });
      setMsg({ tone: "success", text: kind === "check-in" ? "You're checked in. Have a good day!" : "You're checked out. See you tomorrow." });
      reload();
      onChange?.();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function cameraDone(distance: number | null) {
    setCameraOpen(false);
    setMsg({ tone: "success", text: `You're checked in with the camera${distance != null ? ` (${distance} m from the office)` : ""}. Have a good day!` });
    reload();
    onChange?.();
  }

  const rec = data?.record ?? null;
  const cam = data?.camera;
  const done = !!rec?.checkOut;
  const worked = rec ? minutesBetween(rec.checkIn, rec.checkOut, now.getTime()) : null;
  const [hhmm, ss] = [clockFmt.format(now).slice(0, 5), clockFmt.format(now).slice(6, 8)];

  return (
    <section
      aria-label="Today's attendance"
      className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:border-zinc-800/80 dark:bg-zinc-900/50"
    >
      {/* Clock face */}
      <div className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-zinc-900 px-5 pb-5 pt-4 text-white">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border border-white/10" aria-hidden />
        <div className="pointer-events-none absolute -right-2 -top-6 h-24 w-24 rounded-full border border-white/10" aria-hidden />
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-teal-100/80">
            <OpsIcon name="clock" className="h-3.5 w-3.5" /> Time clock · PKT
          </p>
          {rec ? (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-white/20">
              {done ? "Day complete" : "On the clock"}
            </span>
          ) : (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-white/15">Not checked in</span>
          )}
        </div>
        <p className="mt-3 font-semibold leading-none tracking-tight tabular-nums" aria-live="off">
          <span className="text-[2.6rem] sm:text-5xl">{hhmm}</span>
          <span className="ml-1 text-xl text-teal-100/70">{ss}</span>
        </p>
        <p className="mt-2 text-sm text-teal-50/80">{dayFmt.format(now)}</p>
      </div>

      {/* Day details */}
      <div className="flex flex-1 flex-col gap-4 p-5">
        {loading && !data ? (
          <div className="space-y-3" aria-label="Loading">
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
            <Skeleton className="h-10" />
          </div>
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : data ? (
          <>
            <dl className="grid grid-cols-3 divide-x divide-zinc-100 rounded-xl bg-zinc-50 py-3 text-center dark:divide-zinc-800 dark:bg-zinc-900/60">
              <div className="px-2">
                <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500">In</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums">{fmtTime(rec?.checkIn)}</dd>
              </div>
              <div className="px-2">
                <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500">Out</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums">{fmtTime(rec?.checkOut)}</dd>
              </div>
              <div className="px-2">
                <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500">Worked</dt>
                <dd className={cx("mt-1 text-base font-semibold tabular-nums", rec && !done && "text-teal-700 dark:text-teal-300")}>{fmtDuration(worked)}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-zinc-500 dark:text-zinc-400">
              {rec && <StatusPill status={rec.status} />}
              {rec?.source === "camera" && (
                <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300">
                  <OpsIcon name="camera" className="h-3.5 w-3.5" /> Camera{rec.distanceMeters != null ? ` · ${rec.distanceMeters} m` : ""}
                </span>
              )}
              <span>
                Office {data.officeStart} · late after {addClock(data.officeStart, data.graceMinutes)}
                {data.halfDayHours ? ` · half day under ${data.halfDayHours} h` : ""}
              </span>
            </div>

            {!data.isWorkingDay && (
              <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-[13px] text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
                <OpsIcon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                Today is not a working day. A check-in is still recorded.
              </p>
            )}

            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

            <div className="mt-auto">
              {!rec && cam?.required && (
                <div className="space-y-2">
                  <Button onClick={() => setCameraOpen(true)} disabled={!cam.available} className="h-11 w-full text-[15px]">
                    <OpsIcon name="camera" className="h-4 w-4" />
                    Check in with camera
                  </Button>
                  <p className="text-center text-xs text-zinc-500">Your company requires a face + location check-in.</p>
                </div>
              )}
              {!rec && !cam?.required && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={() => act("check-in")} loading={busy} className="h-11 w-full text-[15px] sm:flex-1">
                    {!busy && <OpsIcon name="login" className="h-4 w-4" />}
                    Check in now
                  </Button>
                  {cam?.available && (
                    <Button variant="secondary" onClick={() => setCameraOpen(true)} disabled={busy} className="h-11 w-full text-[15px] sm:w-auto">
                      <OpsIcon name="camera" className="h-4 w-4" />
                      Use camera
                    </Button>
                  )}
                </div>
              )}
              {rec && !done && (
                <Button
                  onClick={() => act("check-out")}
                  loading={busy}
                  className="h-11 w-full bg-zinc-900 text-[15px] hover:bg-zinc-800 active:bg-zinc-950 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {!busy && <OpsIcon name="logout" className="h-4 w-4" />}
                  Check out
                </Button>
              )}
              {!rec && cam?.available && !cam.faceEnrolled && (
                <p className="mt-2 text-center text-xs text-zinc-500">
                  Tip:{" "}
                  <Link href="/profile" className="font-medium text-teal-700 hover:underline dark:text-teal-300">
                    enrol your face
                  </Link>{" "}
                  so camera check-ins are matched to you.
                </p>
              )}
              {done && (
                <p className="flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-50 text-sm font-medium text-teal-800 dark:bg-teal-500/10 dark:text-teal-300">
                  <OpsIcon name="check" className="h-4 w-4" /> All done for today
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>
      {cameraOpen && cam && (
        <CameraCheckIn
          faceEnrolled={!!cam.faceEnrolled}
          maxAccuracyMeters={cam.maxAccuracyMeters}
          radiusMeters={cam.radiusMeters}
          onClose={() => setCameraOpen(false)}
          onDone={cameraDone}
        />
      )}
    </section>
  );
}
