import Link from "next/link";
import { CaseTabs } from "../../../../components/CaseTabs";
import { UnreadNotificationsLink } from "../../../../components/UnreadNotificationsLink";
import { requireClientCase } from "../../../../lib/client-case";
import { signOutAction } from "../../actions";

export default async function ClientCaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId, clientId, item } = await requireClientCase(id);
  const [{ count: unreadCount }, { data: caseChoices, error: choicesError }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId).is("read_at", null),
    supabase.from("cases").select("id, case_number, title")
      .eq("client_id", clientId).order("updated_at", { ascending: false }),
  ]);
  if (choicesError) throw new Error("Не удалось загрузить список дел");
  const root = `/account/cases/${id}`;
  return <main className="account-page">
    <header className="account-header"><Link href="/account" className="account-brand"><span className="auth-brand-mark" aria-hidden="true">сз</span><span>современная <strong>защита</strong></span></Link><div className="account-header-actions"><UnreadNotificationsLink href="/account/notifications" className="account-staff-link" label="События" initialCount={unreadCount ?? 0} /><Link href="/account/profile" className="account-staff-link">Профиль</Link><Link href="/account/help" className="account-staff-link">Помощь</Link><form action={signOutAction}><button type="submit" className="account-signout">Выйти</button></form></div></header>
    <div className="account-content account-detail"><div className="account-case-topline"><Link href="/account#cases" className="account-back">← Все дела</Link>{caseChoices && caseChoices.length > 1 && <details className="account-case-switcher"><summary>Дело № {item.case_number}<span aria-hidden="true">⌄</span></summary><nav aria-label="Переключить дело"><p>Ваши дела</p>{caseChoices.map((choice) => <Link key={choice.id} href={`/account/cases/${choice.id}`} prefetch={false} aria-current={choice.id === id ? "page" : undefined}><span>№ {choice.case_number}</span><strong>{choice.title}</strong></Link>)}</nav></details>}</div><span className="auth-eyebrow">ДЕЛО № {item.case_number}</span><h1>{item.title}</h1><p className="account-case-status">{item.is_suspended ? "Приостановлено" : item.status === "open" ? "В работе" : item.status === "closed" ? "Завершено" : "Отменено"}</p>
      <CaseTabs root={root} caseNumber={item.case_number} />
      {children}
    </div>
  </main>;
}
