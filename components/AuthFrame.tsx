import type { ReactNode } from "react";
import { Brand } from "./Brand";
import { NavIcon } from "./NavIcon";

export function AuthFrame({ children, title, description }: {
  children: ReactNode; title: string; description: string;
}) {
  return <main className="auth-page">
    <header className="auth-header"><Brand href="/login" /><span>Личный кабинет</span></header>
    <div className="auth-layout">
      <section className="auth-intro" aria-label="О личном кабинете">
        <h2>Ваше дело.<br />Всё под рукой.</h2>
        <p>Следите за ходом дела и оставайтесь на связи с вашей командой.</p>
        <ul className="auth-capabilities">
          <li><NavIcon name="cases" size={22} /><div><strong>Ход дела</strong><span>Этапы, задачи и важные сроки</span></div></li>
          <li><NavIcon name="documents" size={22} /><div><strong>Документы</strong><span>Загрузка файлов и результаты проверки</span></div></li>
          <li><NavIcon name="messages" size={22} /><div><strong>Связь с юристом</strong><span>Вся переписка в одном месте</span></div></li>
        </ul>
      </section>
      <section className="auth-main"><div className="auth-content"><h1>{title}</h1><p className="auth-description">{description}</p>{children}</div>
      <p className="auth-main-foot">Не получается войти? Обратитесь к сотруднику, который ведёт ваше дело.</p></section>
    </div>
    <footer className="auth-footer">Современная защита · Личный кабинет клиента и сотрудника</footer>
  </main>;
}
