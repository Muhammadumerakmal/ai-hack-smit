"use client";

import { useCallback, useEffect, useState } from "react";

// Browser-side API helpers. Every screen talks to the REST API through these, so loading,
// error and "please sign in again" handling look the same everywhere.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection.");
  }
  const json = await res.json().catch(() => null);
  // A full page load on purpose: it drops every piece of client state from the old session.
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }
  if (res.status === 403 && json?.error === "password_change_required" && typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/change-password";
  }
  if (!res.ok) throw new ApiError(res.status, json?.message ?? `Request failed (${res.status})`, json?.error);
  return json as T;
}

/** GET a resource. Pass null to skip (e.g. until a filter is ready). Call reload() after a change. */
export function useApi<T>(path: string | null) {
  const [tick, setTick] = useState(0);
  const key = path ? `${path}#${tick}` : null;
  // `key` records which request the stored result belongs to; loading = we have not got this key's result yet.
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });

  useEffect(() => {
    if (!path || !key) return;
    let cancelled = false;
    api<T>(path)
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((e: Error) => !cancelled && setState((s) => ({ key, data: s.data, error: e.message })));
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const loading = !!key && state.key !== key;
  // Keep showing the previous data while a reload is in flight.
  return { data: state.data, error: loading ? null : state.error, loading, reload };
}

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

export const money = (n: number | null | undefined) =>
  n == null ? "—" : `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** "2026-10" → "October 2026" */
export const fmtMonth = (month: string | null | undefined) =>
  month && /^\d{4}-\d{2}$/.test(month)
    ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : (month ?? "—");

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" }) : "—";

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" }) : "—";
