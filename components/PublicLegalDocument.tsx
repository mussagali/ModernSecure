import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { Brand } from "./Brand";
import { LegalText } from "./LegalText";

// Server component: only the currently published legal text is returned to visitors.
export async function PublicLegalDocument({ type }: { type: "terms" | "privacy" }) {
  const title = type === "terms" ? "Условия использования" : "Политика конфиденциальности";
  const key = process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const db = key && url ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const result = db ? await db.from("legal_documents").select("title,body,version,published_at")
    .eq("document_type", type).eq("is_current", true).maybeSingle() : null;
  const document = result?.data;
  return <main className="legal-page">
    <header><Brand href="/login" /><Link href="/login">К входу</Link></header>
    <article><h1>{document?.title || title}</h1>
      {document ? <><p className="legal-version">Версия {document.version}</p><LegalText body={document.body} /></>
        : <p role="status">{result?.error || !db ? "Не удалось загрузить документ. Попробуйте открыть страницу позже." : "Документ ещё не опубликован компанией. Обратитесь к администратору за действующей редакцией."}</p>}
    </article>
    <nav aria-label="Правовая информация"><Link href="/terms">Условия использования</Link><Link href="/privacy">Конфиденциальность</Link><Link href="/deletion-policy">Правила удаления</Link><Link href="/delete-account">Удалить аккаунт</Link><Link href="/support">Поддержка</Link></nav>
  </main>;
}
