type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  onProcessing?: () => void;
  onRequest?: (request: XMLHttpRequest | null) => void;
};

// Only the small manifest crosses the application server. File bytes go to a
// private staging bucket and are checked by the original endpoint on completion.
export async function postFiles(target: string, form: FormData, options: UploadOptions = {}): Promise<Response> {
  const fields: Array<[string, string]> = [];
  const pending: Array<{ field: string; file: File }> = [];
  for (const [field, value] of form.entries()) {
    if (typeof value === "string") fields.push([field, value]);
    else if (value.size || value.name) pending.push({ field, file: value });
  }
  const files: Array<{ field: string; ticket: string }> = [];
  for (const { field, file } of pending) {
    if (file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error("Допустимый размер файла — до 20 МБ.");
    const prepared = await fetch("/api/uploads/prepare", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: options.signal,
      body: JSON.stringify({ target, fields: Object.fromEntries(fields), name: file.name, size: file.size }),
    });
    const result = await prepared.json().catch(() => null) as { ticket?: string; signedUrl?: string; error?: string } | null;
    if (!prepared.ok || !result?.ticket || !result.signedUrl) throw new Error(result?.error ?? "Не удалось подготовить загрузку. Повторите попытку.");
    const signedUrl = new URL(result.signedUrl);
    if (signedUrl.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin) throw new Error("Некорректный адрес хранилища.");
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const abort = () => request.abort();
      options.onRequest?.(request);
      request.open("PUT", signedUrl.toString());
      request.setRequestHeader("Content-Type", "application/octet-stream");
      request.timeout = 180000;
      const finish = (error?: Error) => {
        options.signal?.removeEventListener("abort", abort);
        options.onRequest?.(null);
        if (error) reject(error); else resolve();
      };
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(Math.round(event.loaded / event.total * 100));
      };
      request.onload = () => finish(request.status >= 200 && request.status < 300 ? undefined : new Error("Не удалось передать файл в хранилище. Повторите отправку."));
      request.onerror = () => finish(new Error("Проверьте соединение и повторите загрузку."));
      request.ontimeout = () => finish(new Error("Загрузка заняла слишком много времени. Повторите попытку."));
      request.onabort = () => finish(new Error("Загрузка остановлена."));
      if (options.signal?.aborted) { finish(new Error("Загрузка остановлена.")); return; }
      options.signal?.addEventListener("abort", abort, { once: true });
      request.send(file);
    });
    files.push({ field, ticket: result.ticket });
  }
  options.onProcessing?.();
  return fetch(target, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal: options.signal, body: JSON.stringify({ fields, files }) });
}
