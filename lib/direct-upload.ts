type UploadOptions = { signal?: AbortSignal; onProgress?: (percent: number) => void; onRequest?: (request: XMLHttpRequest | null) => void; onProcessing?: () => void };

export async function uploadForm(target: string, form: FormData, options: UploadOptions = {}): Promise<Response> {
  const fields = Array.from(form.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const files = Array.from(form.entries()).filter((entry): entry is [string, File] => entry[1] instanceof File && entry[1].size > 0);
  if (!files.length) return fetch(target, { method: "POST", body: form, signal: options.signal, headers: { Accept: "application/json" } });
  const tickets: string[] = [];
  for (const [field, file] of files) {
    options.signal?.throwIfAborted();
    const prepare = await fetch("/api/uploads/prepare", { method: "POST", signal: options.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, field, name: file.name, size: file.size, fields }) });
    if (!prepare.ok) throw new Error("Не удалось подготовить загрузку. Проверьте доступ и размер файла.");
    const ticket = await prepare.json();
    options.signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest(); options.onRequest?.(request);
      const abort = () => request.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      request.onloadend = () => options.signal?.removeEventListener("abort", abort);
      request.open("PUT", ticket.signedUrl);
      request.upload.onprogress = event => { if (event.lengthComputable) options.onProgress?.(Math.round(event.loaded / event.total * 100)); };
      request.onerror = () => reject(new Error("Не удалось передать файл. Проверьте интернет и повторите попытку."));
      request.onabort = () => reject(new Error("Загрузка остановлена."));
      request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("Хранилище не приняло файл. Повторите загрузку."));
      const body = new FormData(); body.append("cacheControl", "0"); body.append("", file);
      request.send(body);
    }).finally(() => options.onRequest?.(null));
    tickets.push(ticket.id);
  }
  options.onProcessing?.();
  options.signal?.throwIfAborted();
  return fetch(target, { method: "POST", signal: options.signal, body: JSON.stringify({ tickets }), headers: { "Content-Type": "application/json", Accept: "application/json" } });
}
