import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type CheckedFile = {
  name: string;
  mime: "application/pdf" | "image/jpeg" | "image/png" | "image/heic" | "image/heif";
  size: number;
  sha256: string;
  bytes: Buffer;
};

export function storageAdmin() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function hasPngContainer(bytes: Buffer) {
  if (bytes.length < 57 || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) return false;
  let offset = 8;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (kind === "IDAT") hasImageData = true;
    if (kind === "IEND") return hasImageData && length === 0 && offset + 12 === bytes.length;
    offset += 12 + length;
  }
  return false;
}

export async function checkDocumentFile(file: File): Promise<CheckedFile> {
  const name = file.name.normalize("NFC").trim();
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/u.test(name)
    || file.size < 1 || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("invalid_file");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_DOCUMENT_BYTES) throw new Error("invalid_file");
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  let mime: CheckedFile["mime"];
  if (bytes.length >= 25 && bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    && bytes.subarray(-2048).toString("latin1").trimEnd().endsWith("%%EOF") && extension === ".pdf") {
    mime = "application/pdf";
  } else if (bytes.length >= 32 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
    && (extension === ".jpg" || extension === ".jpeg")) {
    mime = "image/jpeg";
  } else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && hasPngContainer(bytes) && extension === ".png") {
    mime = "image/png";
  } else if (bytes.length >= 32 && bytes.readUInt32BE(0) >= 16
    && bytes.readUInt32BE(0) <= bytes.length - 8 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx"].includes(brand) && extension === ".heic") mime = "image/heic";
    else if (["mif1", "msf1"].includes(brand) && extension === ".heif") mime = "image/heif";
    else throw new Error("invalid_file");
  } else {
    throw new Error("invalid_file");
  }
  return { name, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

export type DocumentBatch = {
  session_id: string;
  status: "pending" | "completed";
  files: Array<{ id: string; path: string; name: string; mime: string; size: number; sha256: string }>;
};
