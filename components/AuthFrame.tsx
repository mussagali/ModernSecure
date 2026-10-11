import Link from "next/link";
import type { ReactNode } from "react";

export function AuthFrame({ children, eyebrow, title, description }: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="Современная защита">
        <Link href="/login" className="auth-brand" aria-label="Современная защита — вход">
          <span className="auth-brand-mark" aria-hidden="true">сз</span>
          <span>современная<br /><strong>защита</strong></span>
        </Link>
        <div className="auth-intro-content">
          <span className="auth-index">ЛИЧНЫЙ КАБИНЕТ <span aria-hidden="true">/</span> 01</span>
          <h2>Ваши вопросы.<br /><em>Наша работа.</em></h2>
          <p>Документы, сообщения и ход дела — в одном защищённом пространстве, доступном с любого устройства.</p>
        </div>
        <div className="auth-intro-foot"><span>Юридическая компания</span><span>Современная защита</span></div>
      </section>
      <section className="auth-main">
        <div className="auth-mobile-brand">современная <strong>защита</strong></div>
        <div className="auth-content">
          <span className="auth-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
        </div>
        <div className="auth-main-foot">Если у вас возникли сложности со входом, свяжитесь с вашей командой сопровождения.</div>
      </section>
    </main>
  );
}
