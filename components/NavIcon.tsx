export type NavIconName = "home" | "clients" | "cases" | "review" | "services" | "team" | "audit" | "notifications" | "settings" | "tasks" | "documents" | "messages" | "payments" | "notes" | "more" | "help" | "arrow" | "back" | "chevron" | "plus" | "close" | "up" | "down";

export function NavIcon({ name, size = 19 }: { name: NavIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "up": return <svg {...common}><path d="M12 20V4m-6 6 6-6 6 6"/></svg>;
    case "down": return <svg {...common}><path d="M12 4v16m-6-6 6 6 6-6"/></svg>;
    case "help": return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1"/></svg>;
    case "arrow": return <svg {...common}><path d="M4 12h16m-6-6 6 6-6 6"/></svg>;
    case "back": return <svg {...common}><path d="M20 12H4m6-6-6 6 6 6"/></svg>;
    case "chevron": return <svg {...common}><path d="m9 5 7 7-7 7"/></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "close": return <svg {...common}><path d="m6 6 12 12M6 18 18 6"/></svg>;
    case "home": return <svg {...common}><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z"/><path d="M9 21v-7h6v7"/></svg>;
    case "clients": return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1M17 5a3 3 0 0 1 0 6m1.5 3a5 5 0 0 1 2 4v2"/></svg>;
    case "cases": return <svg {...common}><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18M10 12v2h4v-2"/></svg>;
    case "review": return <svg {...common}><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h4m-9 6 2 2 4-4"/></svg>;
    case "services": return <svg {...common}><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>;
    case "team": return <svg {...common}><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20v-1a5.5 5.5 0 0 1 11 0v1m2 0h6v-1a4 4 0 0 0-5-3.9"/></svg>;
    case "audit": return <svg {...common}><path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/></svg>;
    case "notifications": return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case "tasks": return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 10 2 2 4-4M8 17h8"/></svg>;
    case "documents": return <svg {...common}><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h4M9 13h6m-6 4h6"/></svg>;
    case "messages": return <svg {...common}><path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 10h8m-8 3h5"/></svg>;
    case "payments": return <svg {...common}><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M7 15h4"/></svg>;
    case "notes": return <svg {...common}><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>;
    case "more": return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
  }
}
