"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type NavIconName } from "./NavIcon";

const tabs: { suffix: string; label: string; icon: NavIconName }[] = [
  { suffix: "", label: "Обзор", icon: "home" },
  { suffix: "/tasks", label: "Задачи", icon: "tasks" },
  { suffix: "/documents", label: "Документы", icon: "documents" },
  { suffix: "/messages", label: "Сообщения", icon: "messages" },
  { suffix: "/payments", label: "Оплаты", icon: "payments" },
];

const staffTabs = [...tabs, { suffix: "/notes", label: "Заметки команды", icon: "notes" as NavIconName }];

export function CaseTabs({ root, staff, caseNumber }: { root: string; staff?: boolean; caseNumber: string }) {
  const pathname = usePathname();
  return <nav className={staff ? "staff-case-nav" : "case-nav"} aria-label={`Разделы дела № ${caseNumber}`}>
    {(staff ? staffTabs : tabs).map((tab) => {
      const href = `${root}${tab.suffix}`;
      const active = pathname === href;
      return <Link key={href} href={href} aria-current={active ? "page" : undefined}><NavIcon name={tab.icon} size={17} /><span>{tab.label}</span></Link>;
    })}
  </nav>;
}
