import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "../../../../../components/SubmitButton";
import { requireStaffCase } from "../../../../../lib/staff-case";
import { addCaseNote } from "./actions";

export const metadata: Metadata = { title: "Внутренние заметки — Современная защита" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Note = { id: string; author_name: string; body: string; created_at: string };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty",
  }).format(new Date(value));
}

export default async function StaffCaseNotes({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ beforeAt?: string; beforeId?: string; added?: string; error?: string }>;
}) {
  const { id } = await params;
  const { supabase, item } = await requireStaffCase(id);
  const query = await searchParams;
  const beforeAt = query.beforeAt ?? null;
  const beforeId = query.beforeId ?? null;
  if ((beforeAt === null) !== (beforeId === null)
    || (beforeAt !== null && (!Number.isFinite(Date.parse(beforeAt)) || !uuidPattern.test(beforeId ?? "")))) notFound();
  const { data, error } = await supabase.rpc("staff_case_note_page", {
    p_case_id: id,
    p_before_created_at: beforeAt,
    p_before_id: beforeId,
    p_limit: 31,
  });
  if (error) throw new Error("Не удалось загрузить внутренние заметки");
  const rows = (data ?? []) as Note[];
  const notes = rows.slice(0, 30);
  const last = notes.at(-1);
  const olderHref = rows.length > 30 && last
    ? `/staff/cases/${id}/notes?beforeAt=${encodeURIComponent(last.created_at)}&beforeId=${last.id}`
    : null;

  return <>
    <div className="staff-page-heading"><div><h1>Внутренние заметки</h1><p>{item.title} · обсуждайте рабочие детали отдельно от переписки с клиентом.</p></div></div>
    {query.added === "1" && <div className="staff-alert is-success" role="status">Заметка сохранена в деле.</div>}
    {query.error && <div className="staff-alert is-error" role="alert">{query.error === "invalid" ? "Напишите заметку до 4000 символов." : "Не удалось сохранить заметку. Проверьте доступ и повторите попытку."}</div>}
    <section className="staff-panel staff-notes-compose"><h2>Добавить заметку</h2><p>Клиент не видит этот раздел. Для ответа клиенту откройте «Сообщения».</p>
      <form action={addCaseNote} className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="noteKey" value={randomUUID()} />
        <label>Текст заметки<textarea name="body" required maxLength={4000} rows={5} placeholder="Что важно знать команде по этому делу" /></label>
        <div className="staff-notes-actions"><SubmitButton>Сохранить заметку</SubmitButton><Link href={`/staff/cases/${id}/messages`}>Написать клиенту</Link></div>
      </form>
    </section>
    <section className="staff-list-section"><div className="staff-section-heading"><h2>История заметок</h2><span>Автор и время сохраняются</span></div>
      {notes.length ? <ol className="staff-notes-list">{notes.map((note) => <li key={note.id}><div><strong>{note.author_name}</strong><time dateTime={note.created_at}>{dateTime(note.created_at)}</time></div><p>{note.body}</p></li>)}</ol>
        : <div className="staff-empty-box"><h3>Заметок пока нет</h3><p>Зафиксируйте внутренний контекст дела — он останется доступен команде после переназначения.</p></div>}
      {olderHref && <div className="staff-pagination"><Link href={olderHref}>Более ранние заметки</Link></div>}
    </section>
  </>;
}
