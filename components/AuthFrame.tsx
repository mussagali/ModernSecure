import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "./Brand";
import { NavIcon } from "./NavIcon";

export function AuthFrame({ children, title, description, wide = false }: {
  children: ReactNode; title: string; description: string; wide?: boolean;
}) {
  return <main className={`auth-page${wide ? " auth-page-wide" : ""}`}>
    <header className="auth-header"><Brand href="/login" /></header>
    <aside className="auth-context"><div><h2>Всё, что нужно<br />для работы с делом.</h2><p>Личное пространство клиента и команды «Современной защиты».</p><ul><li><NavIcon name="cases" /><span><strong>Дела и сроки</strong><small>Этапы, задачи и ближайшие действия</small></span></li><li><NavIcon name="documents" /><span><strong>Документы</strong><small>Файлы, замечания и история версий</small></span></li><li><NavIcon name="messages" /><span><strong>Связь с командой</strong><small>Переписка в контексте вашего дела</small></span></li></ul></div></aside>
    <div className="auth-layout">
      <section className="auth-main" aria-labelledby="auth-title"><div className="auth-content"><h1 id="auth-title">{title}</h1><p className="auth-description">{description}</p>{children}</div></section>
    </div>
    <footer className="auth-footer"><nav aria-label="Помощь и правовая информация"><Link href="/support">Поддержка</Link><Link href="/delete-account">Удаление аккаунта</Link><Link href="/terms">Условия использования</Link><Link href="/privacy">Конфиденциальность</Link></nav></footer>
  </main>;
}
