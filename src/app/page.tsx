"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { api } from "@/lib/client";

// Fresh install → first-run setup; otherwise → dashboard (the shell sends signed-out users to /login).
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/setup")
      .then((s) => router.replace(s.needsSetup ? "/setup" : "/dashboard"))
      .catch(() => router.replace("/login"));
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loading />
    </div>
  );
}
