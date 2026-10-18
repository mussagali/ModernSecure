"use client";
import { postFiles } from "../lib/direct-upload";

import Link from "next/link";
import { NavIcon } from "./NavIcon";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { canPreviewFile } from "../lib/file-preview";
import styles from "./StaffChat.module.css";

type Conversation = {
  user_id: string;
  display_name: string;
  role: "lawyer" | "manager" | "admin";
  active: boolean;
  threadId: string | null;
  lastMessageAt: string | null;
  lastMessage: string | null;
  unread: number;
};
type Attachment = { id: string; original_name: string; detected_mime_type: string; size_bytes: number; position: number };
type Message = { id: string; sender_user_id: string; body: string; created_at: string;
  caseRef: { id: string; case_number: string; title: string } | null; attachments: Attachment[] };
type Props = {
  userId: string; selectedId: string | null; selectedThreadId: string | null;
  returnCase: { id: string; caseNumber: string } | null;
  conversations: Conversation[]; messages: Message[];
  olderHref: string | null; historical: boolean; historyPageKey: string;
};
const roleLabels = { admin: "Администратор", manager: "Менеджер", lawyer: "Юрист" };
const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Almaty" });
const fileExtensions = /\.(pdf|jpe?g|png|heic|heif)$/i;
const maxFileBytes = 20 * 1024 * 1024;
const maxTotalBytes = 40 * 1024 * 1024;
function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
function sidebarVersion(rows: Array<{
  user_id: string; display_name: string; active: boolean; threadId: string | null; lastMessageAt: string | null; unread: number;
}>) {
  return JSON.stringify(rows.map((row) => [row.user_id, row.display_name, row.active, row.threadId, row.lastMessageAt, Number(row.unread)]));
}
function subscribeToNetwork(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function StaffChat({ userId, selectedId, selectedThreadId, returnCase, conversations, messages, olderHref, historical, historyPageKey }: Props) {
  const router = useRouter();
  const current = conversations.find((person) => person.user_id === selectedId) ?? null;
  const latestHref = current ? `/staff/chat?${new URLSearchParams({ to: current.user_id, ...(returnCase ? { fromCase: returnCase.id } : {}) })}` : "/staff/chat";
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [showJump, setShowJump] = useState(false);
  const connected = useSyncExternalStore(subscribeToNetwork, () => navigator.onLine, () => true);
  const key = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const markReadRef = useRef<() => void>(() => {});
  const newestId = messages.at(-1)?.id ?? null;
  const sidebarRef = useRef(sidebarVersion(conversations));
  const people = conversations.filter((person) => `${person.display_name} ${roleLabels[person.role]}`.toLocaleLowerCase("ru").includes(filter.toLocaleLowerCase("ru")));

  useEffect(() => {
    followLatest.current = !historical;
    const frame = window.requestAnimationFrame(() => {
      if (timeline.current) timeline.current.scrollTop = historical ? 0 : timeline.current.scrollHeight;
      setShowJump(false);
      if (!historical) markReadRef.current();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, historical, historyPageKey]);
  useEffect(() => {
    if (historical) return;
    const frame = window.requestAnimationFrame(() => {
      if (!timeline.current) return;
      if (followLatest.current) timeline.current.scrollTop = timeline.current.scrollHeight;
      else setShowJump(true);
      if (followLatest.current) markReadRef.current();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historical, newestId]);
  useEffect(() => { sidebarRef.current = sidebarVersion(conversations); }, [conversations]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishable) return;
    const supabase = createBrowserClient(url, publishable);
    const channel = supabase.channel(`staff-chat:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_messages" }, () => router.refresh())
      .subscribe();
    const interval = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const { data, error } = await supabase.rpc("staff_chat_sidebar");
      if (error || !data) return;
      const version = sidebarVersion(data.map((row: {
        user_id: string; display_name: string; active: boolean; thread_id: string | null;
        last_message_at: string | null; unread_count: number;
      }) => ({ user_id: row.user_id, display_name: row.display_name, active: row.active,
        threadId: row.thread_id, lastMessageAt: row.last_message_at, unread: Number(row.unread_count) })));
      if (version !== sidebarRef.current) router.refresh();
    }, 8_000);
    const reconnect = () => router.refresh();
    const reveal = () => { if (document.visibilityState === "visible" && navigator.onLine) router.refresh(); };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reveal);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reveal);
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);
  useEffect(() => {
    if (!selectedThreadId || !newestId || !current?.unread || historical) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishable) return;
    const supabase = createBrowserClient(url, publishable);
    let pending = false;
    let mounted = true;
    const markRead = () => {
      const area = timeline.current;
      if (!area || document.visibilityState !== "visible" || !navigator.onLine || pending) return;
      if (area.scrollHeight - area.scrollTop - area.clientHeight >= 90) return;
      pending = true;
      void (async () => {
        try {
          const { error } = await supabase.rpc("staff_mark_thread_read", {
            p_thread_id: selectedThreadId, p_through_message_id: newestId,
          });
          if (mounted && !error) router.refresh();
        } catch {
          // Keep the unread state if the network request fails.
        } finally {
          pending = false;
        }
      })();
    };
    markReadRef.current = markRead;
    markRead();
    document.addEventListener("visibilitychange", markRead);
    window.addEventListener("online", markRead);
    return () => {
      mounted = false;
      markReadRef.current = () => {};
      document.removeEventListener("visibilitychange", markRead);
      window.removeEventListener("online", markRead);
    };
  }, [router, selectedThreadId, newestId, current?.unread, historical]);

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    const combined = [...files, ...chosen];
    if (combined.length > 5) { setError("Можно приложить не больше 5 файлов."); return; }
    if (combined.some((file) => !fileExtensions.test(file.name) || file.size < 1 || file.size > maxFileBytes || file.name.length > 180)) {
      setError("Подойдут PDF, JPG, PNG, HEIC и HEIF до 20 МБ на файл."); return;
    }
    if (combined.reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) {
      setError("Общий размер вложений не должен превышать 40 МБ."); return;
    }
    setFiles(combined);
    key.current = null;
    setError("");
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!current?.active || (!body && !files.length) || sending) return;
    if (!navigator.onLine) { setError("Нет соединения. Сообщение и файлы остались в форме — отправьте их после восстановления сети."); return; }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishable) { setError("Чат временно недоступен."); return; }
    setSending(true);
    setError("");
    const supabase = createBrowserClient(url, publishable);
    key.current ??= crypto.randomUUID();
    try {
      let threadId = selectedThreadId;
      if (!threadId) {
        const opened = await supabase.rpc("staff_open_thread", { p_recipient_user_id: current.user_id });
        if (opened.error || !opened.data) throw new Error("Не удалось открыть диалог. Проверьте доступ сотрудника.");
        threadId = opened.data as string;
      }
      if (files.length) {
        const form = new FormData();
        form.set("threadId", threadId);
        form.set("key", key.current);
        form.set("body", body);
        if (returnCase) form.set("caseId", returnCase.id);
        files.forEach((file) => form.append("files", file));
        const response = await postFiles("/api/staff-message-attachments", form);
        const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!response.ok || !result?.ok) throw new Error(result?.error || "Не удалось отправить файл. Повторите попытку.");
      } else {
        const result = returnCase
          ? await supabase.rpc("staff_send_case_message", {
            p_thread_id: threadId, p_body: body, p_idempotency_key: key.current, p_case_id: returnCase.id,
          })
          : await supabase.rpc("staff_send_message", {
            p_thread_id: threadId, p_body: body, p_idempotency_key: key.current,
          });
        if (result.error) throw new Error(result.error.message === "Case link unavailable"
          ? "Доступ к делу изменился. Обновите страницу." : "Сообщение не отправлено. Повторите попытку.");
      }
      setDraft("");
      setFiles([]);
      key.current = null;
      if (!selectedThreadId || historical) router.replace(latestHref);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "Не удалось связаться с сервером. Сообщение и файлы остались в форме — повторите отправку."
        : cause instanceof Error ? cause.message : "Не удалось отправить сообщение.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function onTimelineScroll() {
    const area = timeline.current;
    if (!area || historical) return;
    const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 90;
    followLatest.current = nearBottom;
    setShowJump(!nearBottom);
    if (nearBottom) markReadRef.current();
  }

  return <div className={`${styles.shell} staff-chat-root${current ? " staff-chat-active" : ""}`}>
    <aside className={`${styles.sidebar}${current ? ` ${styles.sidebarWithSelection}` : ""}`}>
      <div className={styles.sidebarHeader}><h1>Чат команды</h1><p>Диалоги между сотрудниками</p><Link href="/staff/inbox">Переписка с клиентами</Link></div>
      <label className={styles.search}><span className={styles.srOnly}>Поиск сотрудника</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 5 5"/></svg><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Найти коллегу" type="search" /></label>
      <div className={styles.people}>
        {people.length ? people.map((person) => <Link key={person.user_id} href={`/staff/chat?to=${person.user_id}`} className={`${styles.person}${person.user_id === selectedId ? ` ${styles.personActive}` : ""}`} aria-current={person.user_id === selectedId ? "page" : undefined}>
          <span className={styles.avatar}>{person.display_name.trim().slice(0, 1).toLocaleUpperCase("ru")}</span>
          <span className={styles.personBody}><span className={styles.personTop}><strong>{person.display_name}</strong>{person.lastMessageAt && <time dateTime={person.lastMessageAt}>{day.format(new Date(person.lastMessageAt))}</time>}</span><span className={styles.personRole}>{roleLabels[person.role]}{!person.active ? " · доступ закрыт" : ""}</span><span className={styles.snippet}>{person.lastMessage ?? (person.active ? "Написать сообщение" : "История переписки")}</span></span>
          {person.unread > 0 && <span className={styles.badge} aria-label={`${person.unread} непрочитанных`}>{person.unread}</span>}
        </Link>) : <p className={styles.noPeople}>{filter ? "Сотрудник не найден" : "Других сотрудников пока нет"}</p>}
      </div>
    </aside>
    <section className={`${styles.conversation}${current ? ` ${styles.conversationSelected}` : ""}`} aria-label={current ? `Диалог с ${current.display_name}` : "Выберите сотрудника"}>
      {current ? <>
        <header className={styles.header}><Link href="/staff/chat" className={styles.back} aria-label="К списку сотрудников"><NavIcon name="back" /></Link><span className={styles.avatar}>{current.display_name.trim().slice(0, 1).toLocaleUpperCase("ru")}</span><span className={styles.headerTitle}><strong>{current.display_name}</strong><small>{roleLabels[current.role]} · приватный диалог</small></span>{!connected && <span className={`${styles.connection} ${styles.offline}`} role="status"><i />Нет сети</span>}</header>
        {returnCase && <div className={styles.caseReturn}><span>Новые сообщения будут связаны с делом № {returnCase.caseNumber}. Клиент их не увидит.</span><Link href={`/staff/cases/${returnCase.id}`}>К делу</Link><Link href={`/staff/chat?to=${current.user_id}`}>Убрать связь</Link></div>}
        {(olderHref || historical) && <nav className={styles.historyBar} aria-label="История диалога">{olderHref && <Link href={olderHref}>Ранние сообщения</Link>}{historical && <Link href={latestHref}>К последним</Link>}</nav>}
        <div className={styles.timelineWrap}><div ref={timeline} onScroll={onTimelineScroll} className={`${styles.timeline}${historical ? ` ${styles.historical}` : ""}`}>
          {messages.length ? messages.map((message) => <article key={message.id} className={`${styles.message}${message.sender_user_id === userId ? ` ${styles.mine}` : ""}`}>
            {message.caseRef && <Link className={styles.caseCard} href={`/staff/cases/${message.caseRef.id}`}><span>Дело № {message.caseRef.case_number}</span><strong>{message.caseRef.title}</strong><small>Открыть карточку</small></Link>}
            {(message.body !== "Вложение" || !message.attachments.length) && <p>{message.body}</p>}
            {!!message.attachments.length && <div className={styles.attachments}>{message.attachments.map((file) => <a key={file.id}
              href={`/api/staff-message-attachments/${file.id}${canPreviewFile(file.detected_mime_type) ? "?preview=1" : ""}`}
              target="_blank" rel="noopener noreferrer" className={styles.fileCard}>
              <span aria-hidden="true"><NavIcon name="documents" /></span>
              <span><strong>{file.original_name}</strong><small>{fileSize(file.size_bytes)} · {canPreviewFile(file.detected_mime_type) ? "Открыть" : "Скачать"}</small></span>

            </a>)}</div>}
            <time dateTime={message.created_at}>{time.format(new Date(message.created_at))}</time>
          </article>)
            : <div className={styles.empty}><span><NavIcon name="messages" size={36} /></span><h2>Начните диалог</h2><p>Пишите коллеге напрямую. Клиент не увидит эти сообщения.</p></div>}
        </div>{showJump && !historical && <button type="button" className={styles.jumpButton} onClick={() => { if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; followLatest.current = true; setShowJump(false); markReadRef.current(); }}>К последним сообщениям</button>}</div>
        {current.active ? <div className={styles.footer}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <form onSubmit={send} className={styles.composer}>
            {!!files.length && <div className={styles.queued} aria-label="Выбранные файлы">{files.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`} className={styles.queuedFile}>
              <span title={file.name}>{file.name}</span><small>{fileSize(file.size)}</small>
              <button type="button" disabled={sending} onClick={() => { setFiles(files.filter((_, position) => position !== index)); key.current = null; }} aria-label={`Убрать ${file.name}`}><NavIcon name="close" size={18} /></button>
            </span>)}</div>}
            <div className={styles.composeRow}>
              <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" multiple onChange={addFiles} disabled={sending} className={styles.hiddenFile} tabIndex={-1} aria-hidden="true" />
              <button type="button" className={styles.attachButton} onClick={() => fileInput.current?.click()} disabled={sending} aria-label="Прикрепить файлы" title="Прикрепить файлы"><NavIcon name="plus" /></button>
              <textarea value={draft} onChange={(event) => { setDraft(event.target.value); key.current = null; }} onKeyDown={onKeyDown} maxLength={4000} rows={1} disabled={sending} placeholder="Напишите коллеге…" aria-label="Сообщение коллеге" />
              <button type="submit" className={styles.sendButton} disabled={sending || (!draft.trim() && !files.length)} aria-label={sending ? "Отправка" : "Отправить сообщение"}>{sending ? "…" : <NavIcon name="arrow" />}</button>
            </div>
          </form>
          <small>PDF и фото до 20 МБ · Enter — отправить · Shift+Enter — новая строка</small>
        </div>
          : <div className={styles.closed}>Доступ коллеги закрыт. История диалога сохранена, новые сообщения недоступны.</div>}
      </> : <div className={styles.welcome}><span><NavIcon name="messages" size={36} /></span><h2>Команда рядом</h2><p>Выберите сотрудника слева, чтобы начать приватную переписку.</p><p>Обсуждение с клиентом остаётся отдельно в карточке дела.</p></div>}
    </section>
  </div>;
}
