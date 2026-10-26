"use client";

import { createBrowserClient } from "@supabase/ssr";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const UnreadCaseCount = createContext<number | null>(null);

export function StaffUnreadCaseProvider({ initialCount, children }: { initialCount: number | null; children: ReactNode }) {
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;
    const supabase = createBrowserClient(url, key);
    let active = true;
    let latestRequest = 0;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const request = ++latestRequest;
      try {
        const { data, error } = await supabase.rpc("staff_unread_case_count");
        const nextCount = Number(data);
        if (active && request === latestRequest && !error && Number.isSafeInteger(nextCount) && nextCount >= 0) {
          setCount(nextCount);
        }
      } catch {
        // Preserve the last verified count until the connection recovers.
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const channel = supabase.channel("staff-unread-case-count")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => { void refresh(); })
      .subscribe();
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [initialCount, pathname]);

  return <UnreadCaseCount.Provider value={count}>{children}</UnreadCaseCount.Provider>;
}

export function useStaffUnreadCaseCount() {
  return useContext(UnreadCaseCount);
}
