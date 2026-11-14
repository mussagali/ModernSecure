"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigationDrawer } from "./useNavigationDrawer";
import { ReferenceIcon as Icon, type ReferenceIconName } from "./ReferenceIcon";
import { signOutAction } from "../app/account/actions";
import { isClientNavigationActive } from "../lib/client-navigation";

type Entry = [string, string, ReferenceIconName];
export function ClientShell({ children, caseId, unreadCount = 0 }: { children: React.ReactNode; caseId?: string; unreadCount?: number }) {
  const path = usePathname();
  // The authenticated parent layout is dynamic; query changes must also update navigation.
  const section = useSearchParams().get("section");
  const { menuOpen, setMenuOpen, toggleRef, sidebarRef } = useNavigationDrawer();
  const currentId = path.match(/^\/account\/cases\/([^/]+)/)?.[1] ?? caseId;
  const caseLink = (section: string) => currentId ? `/account/cases/${currentId}/${section}` : `/account/select-case?section=${section}`;
  const groups: Entry[][] = [
    [["/account", "Главная", "House"], ["/account/select-case", "Мои дела", "BriefcaseBusiness"], [caseLink("tasks"), "Задачи", "ListChecks"], [caseLink("documents"), "Документы", "FileLock2"], [caseLink("messages"), "Чат с юристом", "MessageCircle"], [caseLink("payments"), "Договор и оплаты", "CreditCard"]],
    [["/account/help", "Ответы на вопросы", "BadgeHelp"], ["/account/contacts", "Контакты", "Contact"]],
    [["/account/profile", "Настройки", "Settings"], ["/account/notifications", "Уведомления", "Bell"]],
  ];
  return <div className="client-app sovz">
    <a className="skip-link" href="#client-content">К содержимому</a>
    <button ref={toggleRef} aria-controls="workspace-navigation" className="sovz-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen}>{menuOpen ? <Icon name="X" /> : <Icon name="Menu" />}</button>
    {menuOpen && <button tabIndex={-1} className="sovz-menu-backdrop" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <aside ref={sidebarRef} id="workspace-navigation" className={`sovz-sidebar ${menuOpen ? "is-open" : ""}`}>
      <Link href="/account" className="sovz-brand" onClick={() => setMenuOpen(false)}><Image src="/reference/logo.png" alt="" width={40} height={40} unoptimized /><span>Современная<br />защита</span></Link>
      <nav aria-label="Кабинет клиента">{groups.map((group, index) => <div className="sovz-nav-group" key={index}>{group.map(([href, label, icon]) => <Link key={label} href={href} onClick={() => setMenuOpen(false)} aria-current={isClientNavigationActive(path, section, href) ? "page" : undefined}><Icon name={icon} /><span>{label}</span>{label === "Уведомления" && unreadCount > 0 && <small>{unreadCount}</small>}</Link>)}</div>)}<form action={signOutAction}><button className="sovz-signout"><Icon name="LogOut" /><span>Выход</span></button></form></nav>
    </aside>
    <div className="sovz-workspace">
      <div className="sovz-columns"><div id="client-content" className="sovz-main">{children}</div></div>
      <footer className="sovz-footer"><Link href="/privacy">Политика конфиденциальности</Link><Link href="/consent?view=1">Согласие на обработку персональных данных</Link><Link href="/terms">Пользовательское соглашение</Link></footer>
    </div>
  </div>;
}
