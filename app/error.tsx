"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <section className="recovery-panel" role="alert">

    <h1>Попробуем ещё раз?</h1>
    <p>Проверьте подключение к интернету и повторите загрузку. Если ошибка останется, обратитесь к сотруднику через раздел «Помощь».</p>
    <div className="recovery-actions"><button onClick={() => retry()}>Повторить загрузку</button><Link href="/account">В кабинет</Link><Link href="/account/help">Помощь</Link></div>
  </section>;
}
