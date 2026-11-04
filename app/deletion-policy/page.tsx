import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "../../components/Brand";
import legal from "../../content/legal/documents.ru.json";
import { LegalText } from "../../components/LegalText";

export const metadata: Metadata = { title: "Правила удаления аккаунта | Современная защита" };

export default function DeletionPolicyPage() {
  const document = legal.documents.find(item => item.type === "deletion")!;
  return <main className="legal-page"><header><Brand href="/login" /><Link href="/support">Поддержка</Link></header><article><h1>{document.title}</h1><p className="legal-version">Редакция {legal.revision}</p><LegalText body={document.body} /></article><nav aria-label="Правовая информация"><Link href="/delete-account">Отправить запрос на удаление</Link><Link href="/privacy">Конфиденциальность</Link><Link href="/terms">Условия использования</Link></nav></main>;
}
