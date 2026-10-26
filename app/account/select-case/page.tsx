import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountHeader } from "../../../components/AccountHeader";
import { createClient } from "../../../lib/supabase/server";

export default async function SelectCasePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const suffix = section === "documents" ? "/documents" : section === "payments" ? "/payments" : section === "messages" ? "/messages" : "";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data: client, error } = await supabase.from("clients").select("id").eq("user_id", auth.claims.sub).maybeSingle();
  if (error) throw new Error("Не удалось загрузить клиента");
  const { data: cases, error: casesError } = client ? await supabase.from("cases").select("id, title, case_number").eq("client_id", client.id).order("updated_at", { ascending: false }) : { data: [], error: null };
  if (casesError) throw new Error("Не удалось загрузить дела");
  return <main className="account-page"><AccountHeader /><div className="account-content"><h1>{section === "documents" ? "Документы" : section === "payments" ? "Договор и оплаты" : section === "messages" ? "Сообщения" : "Мои дела"}</h1>
    {cases?.length ? <div className="client-more-list">{cases.map(item => <Link key={item.id} href={`/account/cases/${item.id}${suffix}`}>{item.title} · № {item.case_number}</Link>)}</div> : <section className="account-card"><h2>Пока нет дел</h2><p>Когда сотрудник создаст ваше дело, здесь появятся его этапы, документы и оплаты.</p><Link href="/account/help">Помощь и контакты</Link></section>}
  </div></main>;
}
