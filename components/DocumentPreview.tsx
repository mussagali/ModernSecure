"use client";
import { useEffect, useState } from "react";

export function DocumentPreview({ fileId }: { fileId: string }) {
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    fetch(`/api/document-files/${fileId}?preview=1`, { signal: controller.signal, credentials: "same-origin" }).then(async response => {
      if (!response.ok) throw new Error("preview");
      const blob = await response.blob();
      if (!["application/pdf", "image/jpeg", "image/png"].includes(blob.type)) throw new Error("type");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ url: objectUrl, mime: blob.type });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileId]);
  if (failed) return <div className="lawyer-empty" role="status"><h3>Предпросмотр недоступен</h3><p>Скачайте файл или попробуйте открыть его в отдельной вкладке.</p><a href={`/api/document-files/${fileId}?preview=1`} target="_blank" rel="noopener noreferrer">Открыть документ</a></div>;
  if (!preview) return <div className="lawyer-empty" role="status">Загружаем документ…</div>;
  if (preview.mime === "application/pdf") return <object aria-label="Предпросмотр PDF" data={preview.url} type="application/pdf" className="lawyer-pdf"><a href={`/api/document-files/${fileId}?preview=1`} target="_blank" rel="noopener noreferrer">Открыть PDF</a></object>;
  return <div className="lawyer-image-preview">
    {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated temporary blob; no optimizer request. */}
    <img src={preview.url} alt="Загруженный документ" />
  </div>;
}
