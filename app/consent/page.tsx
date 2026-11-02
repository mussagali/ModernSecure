import { AuthFrame } from "../../components/AuthFrame";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { SubmitButton } from "../../components/SubmitButton";
import { signOutAction } from "../account/actions";
import { acceptConsents } from "./actions";
import { requireAccountApproval } from "../../lib/account-access";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  await requireAccountApproval(supabase);
  const { data: documents, error } = await supabase.from("legal_documents").select("id, title, body, version, document_type").eq("is_current", true).order("document_type");
  if (error) throw new Error("Не удалось загрузить условия");
  const query = await searchParams;
  return <AuthFrame wide title="Перед началом работы" description="Прочитайте документы и отметьте своё согласие. Рекламные сообщения — по вашему желанию.">
    <Link href="/account" className="account-back">В кабинет</Link>
    {query.error && <p className="case-feedback is-error" role="alert">Условия могли обновиться. Прочитайте текущую версию и отметьте обязательные пункты.</p>}
    {documents?.length ? <form action={acceptConsents} className="consent-form">{documents.map((doc) => <section key={doc.id} className="case-work-card">
      <details><summary>{doc.title} · версия {doc.version}</summary><div className="legal-body">{doc.body}</div></details>
      <label className="consent-check"><input type="checkbox" name="documentId" value={doc.id} required={doc.document_type !== "marketing"} /><span>{doc.document_type === "marketing" ? "Хочу получать рекламные сообщения (необязательно)" : `Принимаю документ «${doc.title}»`}</span></label>
    </section>)}<SubmitButton>Сохранить и продолжить</SubmitButton></form> : <p className="case-feedback">Компания пока не опубликовала условия. Согласия не запрашиваются и не записываются.</p>}
    <form action={signOutAction} className="auth-signout"><button>Выйти из аккаунта</button></form>
  </AuthFrame>;
}
