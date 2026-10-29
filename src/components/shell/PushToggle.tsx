"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

// "Get alerts on this device": Web Push, so leave decisions, payslips and announcements pop up on the phone or
// computer like app notifications, even when HCM Lite is closed. The service worker (public/sw.js) shows them.

type State = "loading" | "unsupported" | "off-server" | "ios-install" | "blocked" | "off" | "on" | "busy";

/** VAPID public keys are URL-safe base64; PushManager wants the raw bytes. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** The service worker registration, if the app registered one (production builds). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const set = (s: State) => !cancelled && setState(s);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone Safari only exposes push once the app is added to the Home Screen.
        return set(typeof navigator !== "undefined" && isIos() && !isInstalled() ? "ios-install" : "unsupported");
      }
      const info = await api<{ enabled: boolean; publicKey: string | null }>("/api/push").catch(() => null);
      if (!info?.enabled || !info.publicKey) return set("off-server");
      if (!cancelled) setKey(info.publicKey);
      if (Notification.permission === "denied") return set("blocked");
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      set(sub ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    if (!key) return;
    setError(null);
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await registration();
      if (!reg) throw new Error("Alerts work in the installed or live app, not in development mode.");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const json = sub.toJSON();
      await api("/api/push", { body: { endpoint: json.endpoint, keys: json.keys } });
      setState("on");
    } catch (e) {
      setError((e as Error).message || "Could not turn on alerts.");
      setState("off");
    }
  }

  async function turnOff() {
    setError(null);
    setState("busy");
    try {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) {
        await api(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" }).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError((e as Error).message);
      setState("on");
    }
  }

  if (state === "loading" || state === "off-server") return null;

  return (
    <div className="border-t border-zinc-200/70 px-3 py-2.5 text-xs dark:border-white/10">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/15 dark:bg-teal-500/10 dark:text-teal-300" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M11 18.5h2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-800 dark:text-zinc-100">Alerts on this device</p>
          <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            {state === "on" && "On: leave, payslip and announcement alerts pop up here."}
            {(state === "off" || state === "busy") && "Get leave, payslip and announcement alerts like app notifications."}
            {state === "blocked" && "Blocked in this browser. Allow notifications for this site in your browser settings, then reload."}
            {state === "ios-install" && "On iPhone: tap Share → Add to Home Screen, open HCM Lite from there, then turn alerts on."}
            {state === "unsupported" && "This browser can't show alerts. Try Chrome, Edge, Firefox or Safari."}
          </p>
        </div>
        {(state === "off" || state === "on" || state === "busy") && (
          <button
            type="button"
            onClick={state === "on" ? turnOff : turnOn}
            disabled={state === "busy"}
            role="switch"
            aria-checked={state === "on"}
            aria-label="Alerts on this device"
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${state === "on" ? "bg-teal-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${state === "on" ? "left-[22px]" : "left-0.5"}`} />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
