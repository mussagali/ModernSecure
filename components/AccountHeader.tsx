"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { NavIcon } from "./NavIcon";
import { UnreadNotificationsLink } from "./UnreadNotificationsLink";
export function AccountHeader({ unreadCount = 0 }: { unreadCount?: number }) {
  const path = usePathname();
  return <header className="account-header client-header"><div className="account-header-top"><Brand /><div className="client-header-tools">
    <UnreadNotificationsLink href="/account/notifications" label="Уведомления" icon={<NavIcon name="notifications" />} initialCount={unreadCount} active={path === "/account/notifications"} />
    <Link className="client-avatar" href="/account/more" aria-label="Профиль и ещё"><NavIcon name="clients" /></Link>
  </div></div></header>;
}
