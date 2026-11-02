import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountHeader } from "../../../components/AccountHeader";
import { NavIcon, type NavIconName } from "../../../components/NavIcon";
import { createClient } from "../../../lib/supabase/server";
import { signOutAction } from "../actions";
import { installmentPaidAmounts } from "../../../lib/payment-summary";
import { formatKzt, toKztCents } from "../../../lib/money";
import { formatKzDate } from "../../../lib/client-case";

export default async function MorePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const [{ data: profile, error }, { data: client, error: clientError }] = await Promise.all([
    supabase.from("profiles").select("display_name, email").eq("user_id", auth.claims.sub).maybeSingle(),
    supabase.from("clients").select("id, full_name").eq("user_id", auth.claims.sub).maybeSingle(),
  ]);
  if (error || clientError) throw new Error("Не удалось загрузить профиль");
  const { data: cases, error: casesError } = client ? await supabase.from("cases").select("id, title, status").eq("client_id", client.id).order("updated_at", { ascending: false }) : { data: [], error: null };
  if (casesError) throw new Error("Не удалось загрузить дела");
  const caseId = cases?.[0]?.id;
  const [schedule, payments, allocations] = caseId ? await Promise.all([
    supabase.from("payment_schedule").select("id, due_on, amount_kzt, cancelled_at").eq("case_id", caseId).order("due_on"),
    supabase.from("payments").select("id, status").eq("case_id", caseId).eq("status", "confirmed"),
    supabase.from("payment_allocations").select("payment_id, schedule_id, amount_kzt").eq("case_id", caseId),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (schedule.error || payments.error || allocations.error) throw new Error("Не удалось загрузить оплаты");
  const paidByInstallment = installmentPaidAmounts(payments.data ?? [], allocations.data ?? []);
  const nextPayment = cases?.[0]?.status !== "open" ? undefined : (schedule.data ?? []).filter(row => !row.cancelled_at).map(row => ({ ...row, remaining: toKztCents(row.amount_kzt) - (paidByInstallment.get(row.id) ?? BigInt(0)) })).find(row => row.remaining > BigInt(0));
  const name = profile?.display_name || client?.full_name || "Личный кабинет";
  const links: { href: string; title: string; icon: NavIconName }[] = [
    { href: cases?.[0] ? `/account/cases/${cases[0].id}/payments` : "/account/select-case?section=payments", title: "Договор и оплаты", icon: "payments" },
    { href: "/account/notifications", title: "Уведомления", icon: "notifications" },
    { href: "/account/profile", title: "Профиль", icon: "clients" },
    { href: "/account/help", title: "Помощь и контакты", icon: "help" },
  ];
  return <main className="account-page"><AccountHeader /><div className="account-content client-settings"><h1>Ещё</h1>
    <Link href="/account/profile" className="client-profile-summary"><span className="client-avatar">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>{profile?.email}</small></span><NavIcon name="chevron" size={18} /></Link>
    {nextPayment && <Link href={`/account/cases/${caseId}/payments`} className="client-profile-summary client-next-payment"><NavIcon name="payments" size={30} /><span><small>Следующий платёж{cases && cases.length > 1 ? ` · ${cases[0].title}` : ""}</small><strong>{formatKzt(nextPayment.remaining)}</strong><small>до {formatKzDate(nextPayment.due_on)}</small></span><NavIcon name="chevron" size={18} /></Link>}
    <div className="client-more-list">{links.map(link => <Link key={link.href} href={link.href}><NavIcon name={link.icon} /><span>{link.title}</span><NavIcon name="chevron" /></Link>)}</div>
    {cases && cases.length > 1 && <div className="client-more-list"><Link href="/account/select-case"><NavIcon name="cases" />Все мои дела<NavIcon name="chevron" /></Link></div>}
    <form action={signOutAction} className="client-signout"><button type="submit">Выйти из аккаунта</button></form>
  </div></main>;
}
