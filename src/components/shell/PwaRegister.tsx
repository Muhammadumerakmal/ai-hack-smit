"use client";

import { useEffect } from "react";

/** Registers the service worker (public/sw.js) in production builds only, so dev reloads are never served from cache. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not fatal: the app works the same without it, only install/offline are missing.
    });
  }, []);
  return null;
}
