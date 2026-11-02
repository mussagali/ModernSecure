"use client";

import { useState, type ReactNode, type FormEvent } from "react";
import { uploadForm } from "../lib/direct-upload";

export function DirectUploadForm({ action, className, children }: { action: string; className?: string; children: ReactNode }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (working) return;
    const form = new FormData(event.currentTarget);
    setWorking(true); setError("");
    try {
      const response = await uploadForm(action, form);
      if (!response.ok) throw new Error("Файл не принят. Проверьте формат, размер и доступ к делу.");
      const destination = new URL(response.url);
      if (destination.origin !== window.location.origin || !/^\/(account|staff)\//.test(destination.pathname)) throw new Error("Не удалось подтвердить загрузку.");
      window.location.assign(destination.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить файл."); setWorking(false); }
  }
  return <form action={action} method="post" encType="multipart/form-data" className={className} onSubmit={submit}>
    <fieldset disabled={working} className="direct-upload-fields">{children}</fieldset>
    {working && <p role="status">Передаём и проверяем файл…</p>}{error && <p role="alert" className="staff-alert is-error">{error}</p>}
  </form>;
}
