"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { postFiles } from "../lib/direct-upload";

export function FinancialUploadForm({ action, children }: { action: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("Готовим файл…");
    try {
      const response = await postFiles(action, form, {
        onProgress: (percent) => setMessage(`Передаём файл: ${percent}%`),
        onProcessing: () => setMessage("Проверяем и сохраняем файл…"),
      });
      if (response.redirected && new URL(response.url).origin === window.location.origin) {
        window.location.assign(response.url); return;
      }
      throw new Error("Не удалось сохранить файл. Обновите страницу и повторите попытку.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось отправить файл."); setBusy(false); }
  }
  return <form action={action} method="post" encType="multipart/form-data" className="staff-form" onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy} className="upload-form-fields">{children}</fieldset>
    {message && <p role={busy ? "status" : "alert"}>{message}</p>}
    <noscript>Для загрузки файлов включите JavaScript в браузере.</noscript>
  </form>;
}
