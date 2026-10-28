import type { NavIconName } from "../components/NavIcon";

export type StaffRole = "lawyer" | "manager" | "admin";
type StaffNavItem = { href: string; label: string; icon: NavIconName; managerOnly?: boolean; reviewerOnly?: boolean; adminOnly?: boolean };
const items: StaffNavItem[] = [
  { href: "/staff/overview", label: "Обзор", icon: "home" },
  { href: "/staff/cases", label: "Дела", icon: "cases" },
  { href: "/staff/clients", label: "Клиенты", icon: "clients", managerOnly: true },
  { href: "/staff/inbox", label: "Сообщения", icon: "messages" },
  { href: "/staff/chat", label: "Чат команды", icon: "team" },
  { href: "/staff/review", label: "Документы", icon: "review", reviewerOnly: true },
  { href: "/staff/tasks", label: "Задачи", icon: "tasks", adminOnly: true },
  { href: "/staff/calendar", label: "Календарь", icon: "calendar", adminOnly: true },
  { href: "/staff/payments", label: "Оплаты", icon: "payments", adminOnly: true },
  { href: "/staff/services", label: "Услуги", icon: "services", adminOnly: true },
  { href: "/staff/team", label: "Команда", icon: "team", adminOnly: true },
  { href: "/staff/audit", label: "Журнал", icon: "audit", adminOnly: true },
  { href: "/staff/notifications", label: "Уведомления", icon: "notifications" },
  { href: "/staff/settings", label: "Настройки", icon: "settings", adminOnly: true },
];

export function staffNavigation(role: StaffRole): StaffNavItem[] {
  if (role === "lawyer") return [
    { href: "/staff", label: "Главная", icon: "home" },
    { href: "/staff/cases", label: "Мои дела", icon: "cases" },
    { href: "/staff/clients", label: "Клиенты", icon: "clients" },
    { href: "/staff/review", label: "Документы", icon: "documents" },
    { href: "/staff/tasks", label: "Задачи", icon: "tasks" },
    { href: "/staff/inbox", label: "Сообщения", icon: "messages" },
    { href: "/staff/calendar", label: "Календарь", icon: "calendar" },
    { href: "/staff/payments", label: "Оплаты", icon: "payments" },
    { href: "/staff/chat", label: "Чат команды", icon: "team" },
    { href: "/staff/notifications", label: "Уведомления", icon: "notifications" },
  ];
  return items.filter((item) => (!item.adminOnly || role === "admin")
    && (!item.reviewerOnly || role !== "manager"));
}
