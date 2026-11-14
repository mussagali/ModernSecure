import Link from "next/link";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "../lib/supabase/server";
import { ReferenceIcon } from "./ReferenceIcon";
import "../app/legal-reference.css";

// Server component: only the currently published legal text is returned to visitors.
export async function PublicLegalDocument({ type }: { type: "terms" | "privacy" }) {
  const title = type === "terms" ? "Условия использования" : "Политика конфиденциальности";
  // Public legal pages must work before login and without privileged credentials.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const db = key && url ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const result = db ? await db.from("legal_documents").select("title,body,version,published_at")
    .eq("document_type", type).eq("is_current", true).maybeSingle() : null;
  const document = result?.data;
  // Session state only selects a return link; public document access never depends on it.
  const session = db ? await createSessionClient() : null;
  const auth = session ? await session.auth.getClaims() : null;
  const returnHref = auth?.data?.claims?.sub ? "/account" : "/login";
  return <main className="legal-page reference-legal"><div className="legal-layout">
    <header className="legal-header">
      <Link href={returnHref} className="legal-brand"><Image src="/reference/logo.png" alt="" width={40} height={44} unoptimized /><span>Современная<br />защита</span></Link>
      <Link href={returnHref} className="legal-return"><ReferenceIcon name="ArrowRight" /><span>{returnHref === "/account" ? "В кабинет" : "К входу"}</span></Link>
    </header>
    <nav className="legal-tabs" aria-label="Правовая информация"><Link href="/terms" aria-current={type === "terms" ? "page" : undefined}>Условия использования</Link><Link href="/privacy" aria-current={type === "privacy" ? "page" : undefined}>Конфиденциальность</Link></nav>
    <article className="legal-document">
      <div className="legal-document-heading"><span className="legal-document-icon"><ReferenceIcon name={type === "terms" ? "FileText" : "ShieldCheck"} /></span><h1>{document?.title || title}</h1></div>
      {document ? <><p className="legal-version">Версия {document.version}</p><div className="legal-body">{document.body}</div></>
        : <p className="legal-notice" role="status">{result?.error || !db ? "Не удалось загрузить документ. Попробуйте открыть страницу позже." : "Документ ещё не опубликован компанией. Обратитесь к администратору за действующей редакцией."}</p>}
    </article>
    </div>
  </main>;
}
