import Link from "next/link";
import type { ReactNode } from "react";
import { NavIcon } from "./NavIcon";
import { listHref } from "../lib/list-query";

export function ListSearch({ action, query = "", placeholder, label = "Поиск", hidden = {}, children, resetHref }: {
  action: string; query?: string; placeholder: string; label?: string;
  hidden?: Record<string, string>; children?: ReactNode; resetHref?: string;
}) {
  return <form action={action} method="get" role="search" aria-label={label} className="list-search">
    {Object.entries(hidden).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <label className="list-search-field"><NavIcon name="search" size={20} /><span className="sr-only">{label}</span><input name="q" type="search" maxLength={120} defaultValue={query} placeholder={placeholder} /></label>
    {children}
    <button type="submit">Найти</button>
    {resetHref && <Link className="list-reset" href={resetHref}>Сбросить</Link>}
  </form>;
}

export function ListPagination({ path, page, count, pageSize = 25, params = {}, label = "Страницы списка" }: {
  path: string; page: number; count: number; pageSize?: number;
  params?: Record<string, string | number | undefined | null>; label?: string;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (!count && page === 1) return null;
  const href = (target: number) => listHref(path, { ...params, page: target });
  const visible = Array.from(new Set([1, page - 1, page, page + 1, pages])).filter(value => value > 0 && value <= pages).sort((a, b) => a - b);
  return <nav className="list-pagination" aria-label={label}>
    <span className="list-range">{!count ? "Нет результатов" : (page - 1) * pageSize >= count ? `На этой странице нет записей. Всего: ${new Intl.NumberFormat("ru").format(count)}` : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, count)} из ${new Intl.NumberFormat("ru").format(count)}`}</span>
    {pages > 1 || page > 1 ? <div className="list-pages">
      {page > 1 ? <Link href={href(Math.min(page - 1, pages))} aria-label="Предыдущая страница"><NavIcon name="back" size={18} /></Link> : <span aria-disabled="true"><NavIcon name="back" size={18} /></span>}
      {visible.map((value, index) => <span className="list-page-number" key={value}>{index > 0 && value - visible[index - 1] > 1 && <span className="list-gap">…</span>}<Link href={href(value)} aria-label={`Страница ${value}`} aria-current={page === value ? "page" : undefined}>{value}</Link></span>)}
      {page < pages ? <Link href={href(page + 1)} aria-label="Следующая страница"><NavIcon name="chevron" size={18} /></Link> : <span aria-disabled="true"><NavIcon name="chevron" size={18} /></span>}
    </div> : <span className="list-page-summary">Все записи</span>}
  </nav>;
}
