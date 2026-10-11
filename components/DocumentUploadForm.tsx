"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import styles from "./DocumentUploadForm.module.css";

type Props = { caseId: string; requestId: string; view: "client" | "staff" };
type Metadata = { name: string; mime: string; size: number; sha256: string };
type QueuedFile = { id: number; file: File; name: string; mime: string };
type BatchFile = Metadata & { id: string; path: string };
type Batch = { session_id: string; status: "pending" | "completed"; files: BatchFile[] };
type Phase = "idle" | "hashing" | "preparing" | "uploading" | "processing" | "error" | "aborted";
type FileState = "waiting" | "uploading" | "processing" | "uploaded" | "error";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  heic: "image/heic", heif: "image/heif",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkedFile(file: File) {
  const name = file.name.normalize("NFC").trim();
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/u.test(name) || !mime) {
    throw new Error(`«${file.name}»: допустимы только PDF, JPG, PNG, HEIC и HEIF с корректным именем.`);
  }
  if (file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new Error(`«${name}»: размер должен быть больше 0 и не превышать 20 МБ.`);
  }
  return { name, mime };
}

async function sha256(bytes: BufferSource) {
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateBatch(value: unknown, metadata: Metadata[], caseId: string, requestId: string): Batch {
  if (!value || typeof value !== "object") throw new Error("Сервер вернул некорректный ответ подготовки.");
  const batch = value as Partial<Batch>;
  if (typeof batch.session_id !== "string" || !UUID.test(batch.session_id)
    || (batch.status !== "pending" && batch.status !== "completed")
    || !Array.isArray(batch.files) || batch.files.length !== metadata.length) {
    throw new Error("Сервер вернул некорректный ответ подготовки.");
  }
  for (let index = 0; index < metadata.length; index += 1) {
    const returned = batch.files[index];
    const expected = metadata[index];
    if (!returned || typeof returned.id !== "string" || !UUID.test(returned.id)
      || returned.path !== `${caseId}/${requestId}/${batch.session_id}/${returned.id}`
      || returned.name !== expected.name || returned.mime !== expected.mime
      || returned.size !== expected.size || returned.sha256 !== expected.sha256) {
      throw new Error("Подготовленный набор файлов не совпадает с выбранным порядком. Повторите попытку.");
    }
  }
  return batch as Batch;
}

function uploadFile(sessionId: string, fileId: string, file: File, onProgress: (percent: number) => void,
  onProcessing: () => void, onRequest: (request: XMLHttpRequest | null) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    onRequest(request);
    request.open("POST", "/api/document-uploads/file");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    };
    request.upload.onload = onProcessing;
    request.onerror = () => reject(new Error("Не удалось передать файл. Проверьте соединение и повторите попытку."));
    request.onabort = () => reject(new Error("Загрузка остановлена."));
    request.onload = () => {
      if (request.status !== 200) {
        reject(new Error(`Сервер не принял «${file.name}» (HTTP ${request.status}). Повторите попытку.`));
        return;
      }
      try {
        const response: unknown = JSON.parse(request.responseText);
        if (!response || typeof response !== "object" || (response as { ok?: unknown }).ok !== true
          || (response as { fileId?: unknown }).fileId !== fileId) throw new Error("Invalid response");
        resolve();
      } catch {
        reject(new Error("Сервер вернул некорректное подтверждение загрузки. Повторите попытку."));
      }
    };
    const body = new FormData();
    body.append("sessionId", sessionId);
    body.append("fileId", fileId);
    body.append("file", file);
    request.send(body);
  }).finally(() => onRequest(null));
}

export function DocumentUploadForm({ caseId, requestId, view }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const [fileStates, setFileStates] = useState<Record<number, FileState>>({});
  const [progress, setProgress] = useState<Record<number, number>>({});
  const nextId = useRef(0);
  const runId = useRef(0);
  const busy = useRef(false);
  const activeRequest = useRef<XMLHttpRequest | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const activeStorageKey = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const working = phase === "hashing" || phase === "preparing" || phase === "uploading" || phase === "processing";
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);

  useEffect(() => () => {
    runId.current += 1;
    activeController.current?.abort();
    activeRequest.current?.abort();
  }, []);

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!incoming.length) return;
    try {
      if (files.length + incoming.length > 10) throw new Error("За одну отправку можно выбрать не более 10 файлов.");
      if (totalBytes + incoming.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
        throw new Error("Общий размер файлов не должен превышать 100 МБ.");
      }
      const added = incoming.map((file) => ({ id: ++nextId.current, file, ...checkedFile(file) }));
      setFiles((current) => [...current, ...added]);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить файлы.");
    }
  }

  function move(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const copy = [...current];
      [copy[index], copy[index + direction]] = [copy[index + direction], copy[index]];
      return copy;
    });
  }

  function abort() {
    runId.current += 1;
    activeController.current?.abort();
    activeRequest.current?.abort();
    busy.current = false;
    setPhase("aborted");
    setMessage("Загрузка остановлена. Вы можете повторить отправку того же набора файлов.");
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    if (!files.length) { setMessage("Сначала выберите хотя бы один файл."); return; }
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
      setMessage("Без WebCrypto загрузка недоступна. Откройте страницу в современном браузере через HTTPS.");
      return;
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) { setMessage("Загрузка документов сейчас недоступна."); return; }

    const currentRun = ++runId.current;
    busy.current = true;
    setMessage("");
    setProgress({});
    setFileStates(Object.fromEntries(files.map((item) => [item.id, "waiting"] as const)));
    setPhase("hashing");
    const stillCurrent = () => currentRun === runId.current;
    try {
      const metadata: Metadata[] = [];
      for (const item of files) {
        const checked = checkedFile(item.file);
        const hash = await sha256(await item.file.arrayBuffer());
        if (!stillCurrent()) return;
        metadata.push({ ...checked, size: item.file.size, sha256: hash });
      }
      const fingerprint = await sha256(new TextEncoder().encode(JSON.stringify(metadata)));
      if (!stillCurrent()) return;
      const storageKey = `document-upload:${requestId}:${fingerprint}`;
      activeStorageKey.current = storageKey;
      let idempotencyKey: string;
      try {
        const stored = window.sessionStorage.getItem(storageKey);
        if (stored && /^[0-9a-f]{32}$/i.test(stored)) {
          idempotencyKey = stored;
        } else {
          const random = new Uint8Array(16);
          window.crypto.getRandomValues(random);
          idempotencyKey = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
          window.sessionStorage.setItem(storageKey, idempotencyKey);
        }
      } catch {
        throw new Error("Браузер не позволяет сохранить состояние отправки. Разрешите хранение данных для этого сайта и повторите попытку.");
      }

      setLocked(true);
      setPhase("preparing");
      const controller = new AbortController();
      activeController.current = controller;
      const supabase = createBrowserClient(url, publishableKey);
      const { data, error } = await supabase.rpc("resume_or_begin_document_upload", {
        p_request_id: requestId, p_idempotency_key: idempotencyKey, p_files: metadata,
      }).abortSignal(controller.signal);
      if (!stillCurrent()) return;
      if (error) throw new Error(`Не удалось подготовить отправку: ${error.message}`);
      const batch = validateBatch(data, metadata, caseId, requestId);
      if (batch.status === "pending") {
        setPhase("uploading");
        for (let index = 0; index < files.length; index += 1) {
          if (!stillCurrent()) return;
          const item = files[index];
          const target = batch.files[index];
          setFileStates((current) => ({ ...current, [item.id]: "uploading" }));
          try {
            await uploadFile(batch.session_id, target.id, item.file,
              (percent) => { if (stillCurrent()) setProgress((current) => ({ ...current, [item.id]: percent })); },
              () => { if (stillCurrent()) setFileStates((current) => ({ ...current, [item.id]: "processing" })); },
              (request) => { activeRequest.current = request; });
          } catch (uploadError) {
            if (stillCurrent()) setFileStates((current) => ({ ...current, [item.id]: "error" }));
            throw uploadError;
          }
          if (!stillCurrent()) return;
          setProgress((current) => ({ ...current, [item.id]: 100 }));
          setFileStates((current) => ({ ...current, [item.id]: "uploaded" }));
        }
        setPhase("processing");
        const { error: completeError } = await supabase.rpc("complete_document_upload", {
          p_session_id: batch.session_id,
        }).abortSignal(controller.signal);
        if (!stillCurrent()) return;
        if (completeError) throw new Error(`Не удалось завершить отправку: ${completeError.message}`);
      }
      try { window.sessionStorage.removeItem(storageKey); } catch { /* Upload is complete. */ }
      router.push(`${view === "staff" ? "/staff" : "/account"}/cases/${encodeURIComponent(caseId)}/documents?uploaded=1`);
    } catch (error) {
      if (!stillCurrent()) return;
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Не удалось отправить файлы. Повторите попытку.");
    } finally {
      if (stillCurrent()) {
        busy.current = false;
        activeRequest.current = null;
        activeController.current = null;
      }
    }
  }

  function startOver() {
    if (activeStorageKey.current) {
      try { window.sessionStorage.removeItem(activeStorageKey.current); } catch { /* New metadata gets a new key. */ }
    }
    activeStorageKey.current = null;
    setLocked(false);
    setPhase("idle");
    setMessage("");
    setFileStates({});
    setProgress({});
  }

  const statusLabels: Record<FileState, string> = {
    waiting: "Ожидает", uploading: "Передаётся", processing: "Обрабатывается",
    uploaded: "Передан", error: "Ошибка",
  };

  return <form className={styles.form} onSubmit={send}>
    <label className={styles.picker}>Добавить файлы
      <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" onChange={addFiles} disabled={locked || working} />
    </label>
    <small>До 10 файлов: 20 МБ на файл и 100 МБ за отправку. Порядок можно изменить до отправки.</small>
    {files.length > 0 && <>
      <div className={styles.summary}>{files.length} из 10 файлов · {(totalBytes / 1024 / 1024).toFixed(1)} из 100 МБ</div>
      <ol className={styles.list}>{files.map((item, index) => {
        const status = fileStates[item.id] ?? "waiting";
        return <li className={styles.item} key={item.id}>
          <div className={styles.fileInfo}><strong>{item.name}</strong><small>{(item.file.size / 1024 / 1024).toFixed(1)} МБ · {statusLabels[status]}{status === "uploading" ? ` ${progress[item.id] ?? 0}%` : ""}</small></div>
          {!locked && !working && <div className={styles.controls}>
            <button type="button" aria-label={`Поднять ${item.name}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
            <button type="button" aria-label={`Опустить ${item.name}`} disabled={index === files.length - 1} onClick={() => move(index, 1)}>↓</button>
            <button type="button" aria-label={`Убрать ${item.name}`} onClick={() => setFiles((current) => current.filter((entry) => entry.id !== item.id))}>Убрать</button>
          </div>}
          {(status === "uploading" || status === "processing" || status === "uploaded") && <progress className={styles.progress} value={progress[item.id] ?? 0} max={100} aria-label={`Передача ${item.name}`} />}
        </li>;
      })}</ol>
    </>}
    {message && <p className={phase === "aborted" ? styles.notice : styles.error} role="alert">{message}</p>}
    {working && <p className={styles.notice} role="status">{phase === "hashing" ? "Проверяем файлы…" : phase === "preparing" ? "Подготавливаем отправку…" : phase === "processing" ? "Завершаем отправку…" : "Отправляем файлы по очереди…"}</p>}
    <div className={styles.actions}>
      <button type="submit" disabled={working || files.length === 0}>{locked ? "Повторить отправку" : "Отправить файлы →"}</button>
      {working && <button type="button" className={styles.secondary} onClick={abort}>Остановить</button>}
      {locked && !working && <button type="button" className={styles.secondary} onClick={startOver}>Изменить набор</button>}
    </div>
  </form>;
}

export default DocumentUploadForm;
