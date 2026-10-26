import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, ".env.local"), "utf8");
const entry = (name) => source.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
const url = entry("NEXT_PUBLIC_SUPABASE_URL");
const key = entry("SUPABASE_SECRET_KEY");
const publicKey = entry("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
if (url !== "https://bdkrihsiprkmukyjyspv.supabase.co" || !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key ?? "") || !publicKey) {
  throw new Error("Storage smoke: конфигурация проекта неполная или указывает на другой Supabase.");
}

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, key, options);
const anon = createClient(url, publicKey, options);
const bucket = "modernsecure-files";
const object = `checks/${randomUUID()}.pdf`;
const bytes = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
let uploaded = false;

try {
  const created = await admin.storage.from(bucket).upload(object, bytes, {
    contentType: "application/pdf", upsert: false,
  });
  if (created.error) throw new Error(`Storage upload: ${created.error.message}`);
  uploaded = true;

  const hidden = await anon.storage.from(bucket).download(object);
  if (!hidden.error) throw new Error("Публичный ключ получил приватный файл.");

  const downloaded = await admin.storage.from(bucket).download(object);
  if (downloaded.error || !downloaded.data) {
    throw new Error(`Storage download: ${downloaded.error?.message ?? "пустой ответ"}`);
  }
  const received = Buffer.from(await downloaded.data.arrayBuffer());
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  if (digest(bytes) !== digest(received)) throw new Error("Скачанный файл отличается от загруженного.");
  console.log("Storage smoke: загрузка, приватность и точность скачивания подтверждены.");
} finally {
  if (uploaded) {
    const removed = await admin.storage.from(bucket).remove([object]);
    if (removed.error) throw new Error(`Тестовый объект не удалён: ${removed.error.message}`);
    const remaining = await admin.storage.from(bucket).download(object);
    if (!remaining.error) throw new Error("Тестовый объект всё ещё доступен после удаления.");
    console.log("Storage smoke: тестовый объект удалён.");
  }
}
