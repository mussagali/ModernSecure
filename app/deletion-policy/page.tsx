import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ReferenceIcon } from "../../components/ReferenceIcon";
import legal from "../../content/legal/documents.ru.json";
import "../legal-reference.css";

export const metadata: Metadata = { title: "Правила удаления аккаунта | Современная защита" };

export default function DeletionPolicyPage() {
  const document = legal.documents.find(item => item.type === "deletion")!;
  return <main className="legal-page reference-legal"><div className="legal-layout">
    <header className="legal-header"><Link href="/login" className="legal-brand"><Image src="/reference/logo.png" alt="" width={40} height={44} unoptimized /><span>Современная<br />защита</span></Link><Link href="/support" className="legal-return">Поддержка</Link></header>
    <nav className="legal-tabs" aria-label="Правовая информация"><Link href="/terms">Условия использования</Link><Link href="/privacy">Конфиденциальность</Link><Link href="/deletion-policy" aria-current="page">Удаление аккаунта</Link></nav>
    <article className="legal-document"><div className="legal-document-heading"><span className="legal-document-icon"><ReferenceIcon name="ShieldCheck" /></span><h1>{document.title}</h1></div><p className="legal-version">Редакция {legal.revision}</p><div className="legal-body">{document.body}</div><p className="legal-notice"><Link href="/delete-account">Отправить запрос на удаление</Link></p></article>
  </div></main>;
}
