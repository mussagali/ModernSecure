import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "./Brand";

export function AuthFrame({ children, title, description }: {
  children: ReactNode; title: string; description: string;
}) {
  return <main className="auth-page">
    <header className="auth-header"><Brand href="/login" /></header>
    <div className="auth-layout">
      <section className="auth-intro" aria-label="О сервисе">
        <h2>Каждое дело.<br />Вся команда.</h2>
        <p>Документы, сроки и переписка в общем пространстве компании.</p>
      </section>
      <section className="auth-main"><div className="auth-content"><h1>{title}</h1><p className="auth-description">{description}</p>{children}</div></section>
    </div>
    <footer className="auth-footer"><span>Современная защита</span><nav aria-label="Правовая информация"><Link href="/terms">Условия использования</Link><Link href="/privacy">Конфиденциальность</Link></nav></footer>
  </main>;
}
