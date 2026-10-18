"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ClientRegistrationsLive() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      if (document.activeElement?.closest("form")) return;
      router.refresh();
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
