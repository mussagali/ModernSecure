"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

// Auth registrations are not available through the public Realtime schema.
// Refresh on return and periodically, but preserve an administrator's edits.
export function AccountAccessRefresh({ protectForms = false, showButton = false }: { protectForms?: boolean; showButton?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      if (protectForms && (document.querySelector(".staff-page details[open] form") || document.activeElement?.closest(".staff-page form"))) return;
      router.refresh();
    };
    const interval = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, protectForms]);
  return showButton ? <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending}>{pending ? "Обновляем…" : "Обновить заявки"}</button> : null;
}
