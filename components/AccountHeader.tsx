"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { NavIcon } from "./NavIcon";
import { UnreadNotificationsLink } from "./UnreadNotificationsLink";
import { signOutAction } from "../app/account/actions";

export function AccountHeader({ unreadCount = 0 }: { unreadCount?: number }) {
  const path = usePathname();
  return <header className="account-header">
    <div className="account-header-top"><Brand /><form action={signOutAction}><button className="account-signout" type="submit">Выйти</button></form></div>
    <nav className="account-header-actions" aria-label="Личный кабинет">
      <Link href="/account" aria-current={path === "/account" || path.startsWith("/account/cases/") ? "page" : undefined}><NavIcon name="cases" />Мои дела</Link>
      <UnreadNotificationsLink href="/account/notifications" label="События" icon={<NavIcon name="notifications" />} initialCount={unreadCount} active={path === "/account/notifications"} />
      <Link href="/account/profile" aria-current={path === "/account/profile" ? "page" : undefined}><NavIcon name="clients" />Профиль</Link>
      <Link href="/account/help" aria-current={path === "/account/help" ? "page" : undefined}><NavIcon name="help" />Помощь</Link>
    </nav>
  </header>;
}
