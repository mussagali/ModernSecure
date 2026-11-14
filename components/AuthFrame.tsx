import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export function AuthFrame({ children, title, description, wide = false }: {
  children: ReactNode; title: string; description: string; wide?: boolean;
}) {
  return <main className={`auth-page auth-reference${wide ? " auth-page-wide" : ""}`}>
    <div className="auth-reference-grid">
      <aside className="auth-reference-brand" aria-label="Современная защита, Казахстан">
        <Image src="/reference/logo.png" alt="" width={200} height={220} priority unoptimized />
        <p className="auth-reference-name">Современная<br />защита</p>
        <p className="auth-reference-location">Юридическая компания<br />Казахстан</p>
      </aside>
      <div className="auth-reference-column">
        <section className="auth-main" aria-labelledby="auth-title">
          <div className="auth-content">
            <Link className="auth-reference-mark" href="/login" aria-label="Современная защита — вход в аккаунт"><Image src="/reference/logo.png" alt="" width={76} height={84} priority unoptimized /></Link>
            <h1 id="auth-title">{title}</h1>
            <p className="auth-description">{description}</p>
            {children}
          </div>
        </section>
        <footer className="auth-footer"><nav aria-label="Правовая информация"><Link href="/terms">Условия использования</Link><Link href="/privacy">Конфиденциальность</Link></nav></footer>
      </div>
    </div>
  </main>;
}
