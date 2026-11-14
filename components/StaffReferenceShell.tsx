"use client";

import Link from "next/link";
import Image from "next/image";
import { useNavigationDrawer } from "./useNavigationDrawer";
import { StaffNav, StaffMobileNav } from "./StaffNav";
import { ReferenceIcon as Icon } from "./ReferenceIcon";
import { WorkspaceSearch } from "./WorkspaceSearch";
import { signOutAction } from "../app/account/actions";
import type { StaffRole } from "../lib/workspace-navigation";

export function StaffReferenceShell({ children, role, name, roleLabel, unreadCount, pendingCount }: {
  children: React.ReactNode; role: StaffRole; name: string; roleLabel: string; unreadCount: number; pendingCount: number;
}) {
  const { menuOpen, setMenuOpen, toggleRef, sidebarRef } = useNavigationDrawer();
  return <div className={`sovz staff-reference${role === "lawyer" ? " lawyer-shell" : ""}`}>
    <a className="skip-link" href="#main-content">К содержимому</a>
    <button ref={toggleRef} aria-controls="workspace-navigation" className="sovz-menu-toggle" type="button" aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "X" : "Menu"} /></button>
    {menuOpen && <button tabIndex={-1} className="sovz-menu-backdrop" type="button" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <aside ref={sidebarRef} id="workspace-navigation" className={`sovz-sidebar staff-reference-sidebar${menuOpen ? " is-open" : ""}`} onClick={event => { if ((event.target as HTMLElement).closest("a")) setMenuOpen(false); }}>
      <Link href="/staff/overview" className="sovz-brand"><Image src="/reference/logo.png" width={40} height={40} alt="" unoptimized /><span>Современная<br />защита</span></Link>
      <StaffNav role={role} unreadCount={unreadCount} pendingCount={pendingCount} reference />
      <div className="staff-reference-account"><form action={signOutAction}><button type="submit"><Icon name="LogOut" />Выход</button></form><div className="staff-reference-person"><span className="sovz-avatar">{name.trim().slice(0,1).toUpperCase()}</span><span>{name}<small>{roleLabel}</small></span></div></div>
    </aside>
    <div className="sovz-workspace">
      <header className="sovz-topbar"><div className="staff-reference-search"><WorkspaceSearch /></div><Link className="sovz-button sovz-transfer" href={role === "lawyer" ? "/staff/tasks#create" : "/staff/clients?new=1"}><Icon name={role === "lawyer" ? "FileText" : "UserPlus"} size={16} />{role === "lawyer" ? "Добавить задачу" : "Добавить клиента"}</Link></header>
      <div className="sovz-columns"><main className="staff-page" id="main-content">{children}</main></div>
      <footer className="sovz-footer"><Link href="/privacy">Политика конфиденциальности</Link><Link href="/terms">Пользовательское соглашение</Link></footer>
    </div>
    <div className="staff-mobile-nav"><StaffMobileNav role={role} unreadCount={unreadCount} pendingCount={pendingCount} reference /></div>
  </div>;
}
