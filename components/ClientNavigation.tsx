"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon, type NavIconName } from "./NavIcon";
export function ClientNavigation({ caseId, variant = "mobile" }: { caseId?: string; variant?: "desktop" | "mobile" }) {
  const path = usePathname();
  const section = useSearchParams().get("section");
  const currentId = path.match(/^\/account\/cases\/([^/]+)/)?.[1] ?? caseId;
  const root = currentId ? `/account/cases/${currentId}` : "/account/select-case";
  const links: { href: string; label: string; icon: NavIconName; active: boolean }[] = [
    { href: "/account", label: "Моё дело", icon: "documents", active: path === "/account" },
    { href: "/account/select-case", label: "Все дела", icon: "cases", active: (path.startsWith("/account/cases/") && !path.endsWith("/documents") && !path.endsWith("/messages")) || (path === "/account/select-case" && !["documents", "messages"].includes(section ?? "")) },
    { href: currentId ? `${root}/documents` : "/account/select-case?section=documents", label: "Документы", icon: "documents", active: path.endsWith("/documents") || (path === "/account/select-case" && section === "documents") },
    { href: currentId ? `${root}/messages` : "/account/select-case?section=messages", label: "Чат с юристом", icon: "messages", active: path.endsWith("/messages") || (path === "/account/select-case" && section === "messages") },
    { href: "/account/more", label: "Ещё", icon: "more", active: ["/account/more", "/account/profile", "/account/help", "/account/notifications"].includes(path) },
  ];
  if (variant === "desktop") {
    links.pop();
    links.push(
      { href: currentId ? `${root}/tasks` : "/account/select-case?section=tasks", label: "Задачи", icon: "tasks", active: path.endsWith("/tasks") || section === "tasks" },
      { href: currentId ? `${root}/payments` : "/account/select-case?section=payments", label: "Оплата", icon: "payments", active: path.endsWith("/payments") || section === "payments" },
      { href: "/account/help", label: "Ответы на вопросы", icon: "help", active: path === "/account/help" },
      { href: "/account/notifications", label: "Уведомления", icon: "notifications", active: path === "/account/notifications" },
      { href: "/account/profile", label: "Настройки", icon: "settings", active: path === "/account/profile" },
    );
    links[1].active = path === "/account/select-case" && !section || /^\/account\/cases\/[^/]+$/.test(path);
  }
  return <nav className={variant === "desktop" ? "client-desktop-nav" : "client-bottom-nav"} aria-label="Личный кабинет">{links.map(link => <Link key={link.label} href={link.href} aria-current={link.active ? "page" : undefined}><NavIcon name={link.icon} size={22} /><span>{link.label}</span></Link>)}</nav>;
}
