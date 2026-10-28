"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// All reads/subscriptions use the client's session and existing RLS policies.
// Chat has its own cursor, realtime subscription and retry polling.
export function ClientDataSync({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    let disposed = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (disposed || !navigator.onLine || document.visibilityState !== "visible" || pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (!disposed && navigator.onLine && document.visibilityState === "visible") router.refresh();
      }, 350);
    };
    const channel = supabase.channel(`client-workspace:${userId}`);
    for (const table of ["clients", "profiles", "cases", "case_stage_events", "document_requests", "document_files", "tasks", "payment_schedule", "payments", "contracts", "notifications"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();
    // Publication configuration or reconnects must not leave a stale cabinet.
    const interval = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login");
        router.refresh();
      }
    });
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(pending);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      subscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);
  return null;
}
