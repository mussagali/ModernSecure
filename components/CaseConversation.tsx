"use client";
import { postFiles } from "../lib/direct-upload";

import { NavIcon } from "./NavIcon";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { canPreviewFile } from "../lib/file-preview";
import styles from "./CaseConversation.module.css";

type Attachment = { id: string; original_name: string; size_bytes: number; detected_mime_type: string | null; position: number };
type Message = { id: string; sender_user_id: string; body: string; created_at: string; message_attachments: Attachment[] };
type MessageCursor = { created_at: string; id: string };

type Props = {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  backHref: string;
  backLabel?: string;
  contactName: string;
  viewer: "staff" | "client";
  userId: string;
  clientUserId?: string | null;
  senderNames: Record<string, string>;
  businessHours?: string | null;
  responseExpectation?: string | null;
  messages: Message[];
  olderCursor: MessageCursor | null;
  canSend: boolean;
  unread: number;
  readControl?: ReactNode;
  initialNotice?: string;
  initialError?: string;
};

const maxFiles = 5;
const maxFileBytes = 20 * 1024 * 1024;
const maxTotalBytes = 40 * 1024 * 1024;
const allowedExtensions = /\.(pdf|jpe?g|png|heic|heif)$/i;
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" });
const timeFormatter = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}

function FileIcon({ image = false }: { image?: boolean }) {
  return image ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/></svg>
    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>;
}

export default function CaseConversation({ caseId, caseNumber, caseTitle, backHref, backLabel = "Вернуться к делу", contactName, viewer, userId, clientUserId, senderNames, businessHours, responseExpectation, messages, olderCursor, canSend, unread, readControl, initialNotice, initialError }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const keyRef = useRef<string | null>(null);
  const latestIdRef = useRef<string | null>(messages.at(-1)?.id ?? null);
  const markReadRef = useRef<() => void>(() => {});
  const [visibleMessages, setVisibleMessages] = useState(messages);
  const [previousMessages, setPreviousMessages] = useState(messages);
  if (messages !== previousMessages) {
    setPreviousMessages(messages);
    setVisibleMessages((current) => mergeMessages(current, messages));
  }
  const oldestMessageId = visibleMessages[0]?.id ?? null;
  const [historyCursor, setHistoryCursor] = useState(olderCursor);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const latestMessageId = visibleMessages.at(-1)?.id ?? null;
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState(initialNotice ?? "");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [connection, setConnection] = useState<"live" | "syncing" | "offline">(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "syncing" : "offline");

  useEffect(() => {
    if (timelineRef.current && followLatestRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [latestMessageId]);
  useEffect(() => {
    latestIdRef.current = messages.at(-1)?.id ?? null;
  }, [messages]);
  useLayoutEffect(() => {
    const snapshot = prependScrollRef.current;
    const timeline = timelineRef.current;
    if (!snapshot || !timeline) return;
    timeline.scrollTop = snapshot.top + timeline.scrollHeight - snapshot.height;
    prependScrollRef.current = null;
  }, [oldestMessageId]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key || !latestMessageId) return;
    const supabase = createBrowserClient(url, key);
    let mounted = true;
    let pending = false;
    const markRead = () => {
      const timeline = timelineRef.current;
      if (!timeline || pending || document.visibilityState !== "visible" || !navigator.onLine) return;
      if (timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight >= 90) return;
      pending = true;
      void (async () => {
        try {
          const { data, error } = await supabase.rpc("mark_case_messages_seen", {
            p_case_id: caseId, p_through_message_id: latestMessageId,
          });
          if (mounted && !error && Number(data) > 0) router.refresh();
        } catch {
          // Keep unread state so a later scroll, reconnect or tab return can retry.
        } finally {
          pending = false;
        }
      })();
    };
    markReadRef.current = markRead;
    markRead();
    const onVisible = () => { if (document.visibilityState === "visible") markRead(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", markRead);
    return () => {
      mounted = false;
      markReadRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", markRead);
    };
  }, [caseId, latestMessageId, router]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;
    const supabase = createBrowserClient(url, key);
    let mounted = true;
    const channel = supabase.channel(`case-messages:${caseId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `case_id=eq.${caseId}` }, () => {
        if (mounted) router.refresh();
      })
      .subscribe((status) => {
        if (mounted) setConnection(status === "SUBSCRIBED" ? "live" : navigator.onLine ? "syncing" : "offline");
      });
    async function checkForMessages() {
      if (!mounted || !navigator.onLine) return;
      const { data, error } = await supabase.from("messages").select("id")
        .eq("case_id", caseId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
      if (!mounted) return;
      if (error) { setConnection(navigator.onLine ? "syncing" : "offline"); return; }
      setConnection("live");
      const newest = data?.[0]?.id ?? null;
      if (newest !== latestIdRef.current) {
        latestIdRef.current = newest;
        router.refresh();
      }
    }
    const refresh = () => { if (document.visibilityState === "visible") void checkForMessages(); };
    const online = () => { setConnection("syncing"); router.refresh(); };
    const offline = () => setConnection("offline");
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void checkForMessages(); }, 4_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      void supabase.removeChannel(channel);
    };
  }, [caseId, router]);

  async function loadOlder() {
    if (!historyCursor || historyLoading) return;
    if (!navigator.onLine) { setHistoryError("Нет соединения. Вернитесь к истории после восстановления сети."); return; }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) { setHistoryError("История временно недоступна."); return; }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const supabase = createBrowserClient(url, key);
      const { data, error } = await supabase.rpc("case_message_page", {
        p_case_id: caseId,
        p_before_created_at: historyCursor.created_at,
        p_before_id: historyCursor.id,
        p_limit: 51,
      });
      if (error) throw new Error("Не удалось загрузить ранние сообщения. Повторите попытку.");
      const rows = (data ?? []) as Array<Omit<Message, "message_attachments">>;
      const shown = rows.slice(0, 50).reverse();
      const { data: attachments, error: attachmentError } = shown.length
        ? await supabase.from("message_attachments")
          .select("id, message_id, original_name, size_bytes, detected_mime_type, position")
          .in("message_id", shown.map((message) => message.id))
        : { data: [], error: null };
      if (attachmentError) throw new Error("Не удалось загрузить вложения истории. Повторите попытку.");
      const byMessage = new Map<string, Attachment[]>();
      for (const { message_id, ...file } of attachments ?? []) {
        const list = byMessage.get(message_id) ?? [];
        list.push(file);
        byMessage.set(message_id, list);
      }
      const older = shown.map((message) => ({
        ...message,
        message_attachments: (byMessage.get(message.id) ?? []).sort((a, b) => a.position - b.position),
      }));
      if (older.length) {
        const timeline = timelineRef.current;
        if (timeline) prependScrollRef.current = { height: timeline.scrollHeight, top: timeline.scrollTop };
        followLatestRef.current = false;
        setVisibleMessages((current) => mergeMessages(current, older));
        setShowJump(true);
      }
      setHistoryCursor(rows.length > 50 && shown[0]
        ? { created_at: shown[0].created_at, id: shown[0].id } : null);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Не удалось загрузить историю.");
    } finally { setHistoryLoading(false); }
  }

  function changeDraft(value: string) {
    setBody(value);
    keyRef.current = null;
    if (error) setError("");
  }

  function addFiles(incoming: File[]) {
    if (inputRef.current) inputRef.current.value = "";
    if (!incoming.length) return;
    const candidates = [...files, ...incoming];
    if (candidates.length > maxFiles) { setError("Можно прикрепить не более 5 файлов за раз."); return; }
    if (candidates.some((file) => !allowedExtensions.test(file.name) || file.name.length > 180 || file.size < 1 || file.size > maxFileBytes)) {
      setError("Подойдут PDF, JPG, PNG, HEIC и HEIF до 20 МБ каждый; имя файла — до 180 символов."); return;
    }
    if (candidates.reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) {
      setError("Общий размер вложений не должен превышать 40 МБ."); return;
    }
    setFiles(candidates);
    setError("");
    setNotice("");
    keyRef.current = null;
  }

  function onTimelineScroll() {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 90;
    followLatestRef.current = nearBottom;
    setShowJump(!nearBottom);
    if (nearBottom) markReadRef.current();
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    if (!sending) addFiles(Array.from(event.dataTransfer.files));
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !canSend) return;
    if (!body.trim() && !files.length) { setError("Напишите сообщение или прикрепите файл."); return; }
    if (!navigator.onLine) { setError("Нет соединения. Сообщение и файлы остались в форме — отправьте их после восстановления сети."); return; }
    setSending(true);
    setError("");
    setNotice("");
    const key = keyRef.current ?? crypto.randomUUID();
    keyRef.current = key;
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("key", key);
    form.set("view", viewer);
    form.set("body", body);
    files.forEach((file) => form.append("files", file));
    try {
      const response = await postFiles("/api/message-attachments", form);
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Сообщение не отправлено. Попробуйте ещё раз.");
      setBody("");
      setFiles([]);
      keyRef.current = null;
      setNotice("Сообщение отправлено");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "Не удалось связаться с сервером. Сообщение и файлы остались в форме — повторите отправку."
        : cause instanceof Error ? cause.message : "Не удалось отправить сообщение. Проверьте соединение и попробуйте ещё раз.");
    } finally { setSending(false); }
  }

  let previousDay = "";
  return <section className={styles.chat} aria-label={`Переписка по делу № ${caseNumber}`}>
    <header className={styles.header}>
      <Link href={backHref} className={styles.backButton} aria-label={backLabel} title={backLabel}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/></svg></Link>
      <div className={styles.avatar} aria-hidden="true">{contactName.trim().charAt(0).toUpperCase() || "С"}</div>
      <div className={styles.headerText}><h1>{contactName}</h1><span title={caseTitle}>Дело № {caseNumber} · {caseTitle}</span></div>
      <div className={styles.headerRight}>{unread > 0 && <span className={styles.unread}>{unread} новых среди последних</span>}<span className={`${styles.connection} ${connection === "live" ? styles.connectionLive : ""}`} aria-live="polite"><i aria-hidden="true" />{connection === "live" ? "Автообновление" : connection === "offline" ? "Нет соединения" : "Синхронизация"}</span></div>
    </header>

    {viewer === "client" && <div className={styles.serviceInfo}>
      {(businessHours?.trim() || responseExpectation?.trim()) && <div>{businessHours?.trim() && <span>Время работы: {businessHours.trim()}</span>}{responseExpectation?.trim() && <span>Срок ответа: {responseExpectation.trim()}</span>}</div>}
      <Link href="/account/help">Контакты и помощь</Link>
    </div>}

    {(historyCursor || historyError) && <nav className={styles.historyNav} aria-label="История переписки">
      <button type="button" onClick={loadOlder} disabled={!historyCursor || historyLoading}>{historyLoading ? "Загружаем историю…" : "Показать предыдущие сообщения"}</button>
      {historyError && <span role="alert">{historyError}</span>}
    </nav>}

    <div className={styles.timeline} ref={timelineRef} onScroll={onTimelineScroll}><div className={styles.messageStack}>
      {visibleMessages.length === 0 ? <div className={styles.empty}>
        <div className={styles.emptyIcon} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 7.5A3.5 3.5 0 0 1 8.5 4h15A3.5 3.5 0 0 1 27 7.5v13a3.5 3.5 0 0 1-3.5 3.5H13l-6 4v-4.5A3.5 3.5 0 0 1 5 20.5v-13Z"/><path d="M10 11h12M10 16h8"/></svg></div>
        <h2>Начните разговор</h2><p>Сообщения и файлы по этому делу будут храниться здесь. Прикрепите документ или просто напишите вопрос.</p>
      </div> : visibleMessages.map((message) => {
        const day = dateFormatter.format(new Date(message.created_at));
        const showDay = day !== previousDay;
        previousDay = day;
        const own = message.sender_user_id === userId;
        const author = own ? "Вы" : senderNames[message.sender_user_id]
          ?? (viewer === "staff" && message.sender_user_id === clientUserId ? contactName : "Участник дела");
        return <div key={message.id} className={styles.messageGroup}>
          {showDay && <div className={styles.day}><span>{day}</span></div>}
          <article className={`${styles.bubble} ${own ? styles.own : styles.other}`}>
            {!own && <span className={styles.author}>{author}</span>}
            {(message.body !== "Вложение" || message.message_attachments.length === 0) && <p>{message.body}</p>}
            {message.message_attachments.length > 0 && <div className={styles.attachments}>
              {[...message.message_attachments].sort((a, b) => a.position - b.position).map((file) => <a key={file.id} className={styles.fileCard} href={`/api/message-attachments/${file.id}${canPreviewFile(file.detected_mime_type) ? "?preview=1" : ""}`} target="_blank" rel="noopener noreferrer" aria-label={`${canPreviewFile(file.detected_mime_type) ? "Открыть" : "Скачать"} файл ${file.original_name}`}>
                <span className={styles.fileIcon}><FileIcon image={Boolean(file.detected_mime_type?.startsWith("image/"))}/></span>
                <span className={styles.fileInfo}><strong>{file.original_name}</strong><small>{formatSize(file.size_bytes)} · {canPreviewFile(file.detected_mime_type) ? "Открыть" : "Скачать"}</small></span>
                <svg className={styles.fileArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>
              </a>)}
            </div>}
            <time dateTime={message.created_at}>{timeFormatter.format(new Date(message.created_at))}</time>
          </article>
        </div>;
      })}
    </div></div>

    {showJump && <button type="button" className={styles.jumpButton} onClick={() => { if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight; followLatestRef.current = true; setShowJump(false); }}>К последним сообщениям</button>}

    <div className={styles.footer}>
      {readControl && <div className={styles.readControl}>{readControl}</div>}
      {(error || notice) && <div className={`${styles.feedback} ${error ? styles.feedbackError : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}
      {!canSend ? <div className={styles.closed}>Отправка сообщений по этому делу сейчас недоступна.</div> :
        <form className={`${styles.composer} ${dragging ? styles.dragging : ""}`} onSubmit={send} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>
          {files.length > 0 && <div className={styles.queued} aria-label="Выбранные файлы">{files.map((file, index) => <div className={styles.queuedFile} key={`${file.name}-${file.lastModified}-${index}`}><span className={styles.queuedIcon}><FileIcon image={file.type.startsWith("image/")}/></span><span title={file.name}>{file.name}</span><small>{formatSize(file.size)}</small><button type="button" onClick={() => { setFiles(files.filter((_, position) => position !== index)); keyRef.current = null; }} aria-label={`Убрать ${file.name}`} disabled={sending}><NavIcon name="close" size={18} /></button></div>)}</div>}
          <div className={styles.composeRow}>
            <input ref={inputRef} id={`chat-files-${viewer}`} className={styles.hiddenFile} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" multiple onChange={(event) => addFiles(Array.from(event.target.files ?? []))} disabled={sending} tabIndex={-1} aria-hidden="true" />
            <button type="button" className={styles.attachButton} title="Прикрепить файлы" aria-label="Прикрепить файлы" onClick={() => inputRef.current?.click()} disabled={sending}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m8 12.5 6.5-6.5a3.5 3.5 0 0 1 5 5l-9 9a5 5 0 0 1-7-7l9.5-9.5"/></svg></button>
            <textarea value={body} onChange={(event) => changeDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Напишите сообщение…" aria-label="Сообщение" rows={1} maxLength={4000} disabled={sending} />
            <button className={styles.sendButton} type="submit" disabled={sending || (!body.trim() && files.length === 0)} aria-label={sending ? "Отправляется" : "Отправить сообщение"} title="Отправить сообщение"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 14-7-3 14-4-6-7-1Z"/><path d="m12 13 7-8"/></svg></button>
          </div>
          <div className={styles.composeHint}><span>PDF и изображения до 20 МБ · Enter — отправить, Shift+Enter — новая строка</span><span>{files.length}/5 файлов</span></div>
          {dragging && <div className={styles.dropOverlay}>Отпустите файлы, чтобы прикрепить</div>}
        </form>}
    </div>
  </section>;
}
