"use client";

import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import styles from "./UnreadNotificationsLink.module.css";

type UnreadNotificationsLinkProps = {
  href: string;
  className?: string;
  label: string;
  initialCount: number;
  active?: boolean;
  number?: string;
  icon?: ReactNode;
};

export function UnreadNotificationsLink({
  href,
  className,
  label,
  initialCount,
  active,
  number,
  icon,
}: UnreadNotificationsLinkProps) {
  const count = useUnreadNotificationsCount(initialCount);

  const unreadLabel = `Непрочитанных уведомлений: ${count}`;

  return (
    <Link
      href={href}
      className={className ? `${styles.link} ${className}` : styles.link}
      aria-label={count > 0 ? `${label}, ${unreadLabel}` : label}
      aria-current={active ? "page" : undefined}
    >
      {number !== undefined && <span>{number}</span>}
      {icon}
      {label}
      {count > 0 && <b className={styles.badge} aria-hidden="true">{count > 99 ? "99+" : count}</b>}
    </Link>
  );
}

export function useUnreadNotificationsCount(initialCount: number) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;

    const supabase = createBrowserClient(url, key);
    let mounted = true;
    let latestRequest = 0;

    async function refreshCount() {
      const request = ++latestRequest;
      try {
        const { count: unreadCount, error } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null);

        if (mounted && request === latestRequest && !error) {
          setCount(unreadCount ?? 0);
        }
      } catch {
        // Keep the last known count when the network is unavailable.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refreshCount();
    }

    void refreshCount();
    const interval = window.setInterval(() => void refreshCount(), 30_000);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [initialCount]);

  return count;
}

export default UnreadNotificationsLink;
