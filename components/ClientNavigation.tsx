"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon, type NavIconName } from "./NavIcon";
export function ClientNavigation({ caseId }: { caseId?: string }) {
  const path = usePathname();
  const section = useSearchParams().get("section");
  const currentId = path.match(/^\/account\/cases\/([^/]+)/)?.[1] ?? caseId;
  const root = currentId ? `/account/cases/${currentId}` : "/account/select-case";
  const links: { href: string; label: string; icon: NavIconName; active: boolean }[] = [
    { href: "/account", label: "Главная", icon: "home", active: path === "/account" },
    { href: root, label: "Дело", icon: "cases", active: (path === root && !section) || path.endsWith("/tasks") },
    { href: currentId ? `${root}/documents` : "/account/select-case?section=documents", label: "Документы", icon: "documents", active: path.endsWith("/documents") || (path === "/account/select-case" && section === "documents") },
    { href: currentId ? `${root}/messages` : "/account/select-case?section=messages", label: "Сообщения", icon: "messages", active: path.endsWith("/messages") || (path === "/account/select-case" && section === "messages") },
  ];
  if (path.endsWith("/messages")) return null;
  return <nav className="client-bottom-nav" aria-label="Личный кабинет">{links.map(link => <Link key={link.label} href={link.href} aria-current={link.active ? "page" : undefined}><NavIcon name={link.icon} size={23} /><span>{link.label}</span></Link>)}</nav>;
}
