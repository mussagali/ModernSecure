"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UnreadNotificationsLink, useUnreadNotificationsCount } from "./UnreadNotificationsLink";
import { useStaffUnreadCaseCount } from "./StaffUnreadCaseProvider";
import { NavIcon } from "./NavIcon";

import { staffNavigation, type StaffRole } from "../lib/workspace-navigation";
const mobilePrimary = new Map([
  ["/staff/cases", "Дела"],
  ["/staff/clients", "Клиенты"],
  ["/staff/inbox", "Сообщения"],
  ["/staff/chat", "Коллеги"],
]);
const russianPlural = new Intl.PluralRules("ru-RU");
function unreadCaseLabel(count: number) {
  const form = russianPlural.select(count);
  return `${count} ${form === "one" ? "диалог" : form === "few" ? "диалога" : "диалогов"} с непрочитанными сообщениями`;
}


function isActive(path: string, href: string, role: StaffRole) {
  return (role !== "lawyer" && path === "/staff" && href === "/staff/overview") || (role === "lawyer" && path === "/staff/overview" && href === "/staff") || path === href || (href !== "/staff" && path.startsWith(`${href}/`));
}

export function StaffNav({ role, unreadCount }: { role: StaffRole; unreadCount: number }) {
  const path = usePathname();
  const unreadCases = useStaffUnreadCaseCount();
  const [filter, setFilter] = useState("");
  const available = staffNavigation(role).filter(item => item.label.toLocaleLowerCase("ru").includes(filter.toLocaleLowerCase("ru")));
  return <><label className="nav-filter"><NavIcon name="search" size={16} /><span className="sr-only">Найти раздел</span><input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Найти раздел" /></label><nav className="staff-nav" aria-label="Разделы панели">{available.map((item) => {
    const active = isActive(path, item.href, role);
    const className = `staff-nav-link${active ? " is-active" : ""}${item.href === "/staff/services" ? " is-separated" : ""}`;
    if (item.href === "/staff/notifications") {
      return <UnreadNotificationsLink key={item.href} href={item.href} className={className} label={item.label} icon={<span className="staff-nav-icon"><NavIcon name={item.icon} /></span>} initialCount={unreadCount} active={active} />;
    }
    if (item.href === "/staff/inbox") {
      return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
        aria-label={unreadCases !== null && unreadCases > 0 ? `${item.label}, ${unreadCaseLabel(unreadCases)}` : item.label}
        className={className}><span className="staff-nav-icon"><NavIcon name={item.icon} /></span>{item.label}
        {unreadCases !== null && unreadCases > 0 && <b className="staff-nav-count" aria-hidden="true">{unreadCases > 99 ? "99+" : unreadCases}</b>}</Link>;
    }
    return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={className}><span className="staff-nav-icon"><NavIcon name={item.icon} /></span>{item.label}</Link>;
  })}{available.length === 0 && <p className="nav-no-results">Раздел не найден</p>}</nav></>;
}

export function StaffMobileNav({ role, unreadCount }: { role: StaffRole; unreadCount: number }) {
  const path = usePathname();
  const liveUnreadCount = useUnreadNotificationsCount(unreadCount);
  const unreadCases = useStaffUnreadCaseCount();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const available = staffNavigation(role);
  const primary = available.filter((item) => role === "lawyer" ? ["/staff", "/staff/cases", "/staff/inbox"].includes(item.href) : mobilePrimary.has(item.href));
  if (role === "lawyer") {
    const review = available.find((item) => item.href === "/staff/review");
    if (review) primary.push(review);
  }
  const secondary = available.filter((item) => !primary.includes(item));
  const moreActive = secondary.some((item) => isActive(path, item.href, role));

  useEffect(() => {
    detailsRef.current?.removeAttribute("open");
  }, [path]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target)) {
        detailsRef.current?.removeAttribute("open");
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  return <nav className="staff-mobile-primary-nav" aria-label="Основные разделы панели">
    {primary.map((item) => {
      const active = isActive(path, item.href, role);
      return <Link key={item.href} href={item.href}
        aria-label={item.href === "/staff/inbox" && unreadCases !== null && unreadCases > 0 ? `${item.label}, ${unreadCaseLabel(unreadCases)}` : item.label}
        aria-current={active ? "page" : undefined}
        className={`staff-mobile-primary-link${active ? " is-active" : ""}`}>
        <span className="staff-nav-icon"><NavIcon name={item.icon} /></span>
        <span>{mobilePrimary.get(item.href) ?? (item.href === "/staff" ? "Главная" : "Проверка")}</span>
        {item.href === "/staff/inbox" && unreadCases !== null && unreadCases > 0 && <b className="staff-mobile-inbox-badge" aria-hidden="true">{unreadCases > 99 ? "99+" : unreadCases}</b>}
      </Link>;
    })}
    <details ref={detailsRef} className="staff-mobile-more" onKeyDown={(event) => {
      if (event.key === "Escape") {
        detailsRef.current?.removeAttribute("open");
        detailsRef.current?.querySelector("summary")?.focus();
      }
    }}>
      <summary className={`staff-mobile-primary-link${moreActive ? " is-active" : ""}`}
        aria-label={liveUnreadCount > 0 ? `Ещё разделы, ${liveUnreadCount} непрочитанных уведомлений` : "Ещё разделы"}>
        <span className="staff-nav-icon"><NavIcon name="more" /></span>
        <span>Ещё</span>
        {liveUnreadCount > 0 && <b className="staff-mobile-more-badge" aria-hidden="true">{liveUnreadCount > 99 ? "99+" : liveUnreadCount}</b>}
      </summary>
      <div className="staff-mobile-more-panel">
        <p>Остальные разделы</p>
        {secondary.map((item) => {
          const active = isActive(path, item.href, role);
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={`staff-mobile-more-link${active ? " is-active" : ""}`}
            onClick={() => detailsRef.current?.removeAttribute("open")}>
            <span className="staff-nav-icon"><NavIcon name={item.icon} /></span>
            <span>{item.label}</span>
            {item.href === "/staff/notifications" && liveUnreadCount > 0 && <b aria-hidden="true">{liveUnreadCount > 99 ? "99+" : liveUnreadCount}</b>}
          </Link>;
        })}
        <Link href="/staff-security" className="staff-mobile-more-link staff-mobile-security" onClick={() => detailsRef.current?.removeAttribute("open")}><span className="staff-nav-icon"><NavIcon name="settings" /></span><span>Безопасность аккаунта</span></Link>
      </div>
    </details>
  </nav>;
}
