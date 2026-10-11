const previewMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);

export function canPreviewFile(mime: string | null | undefined) {
  return typeof mime === "string" && previewMimeTypes.has(mime);
}

const extensionByMime: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function fileContentDisposition(originalName: string, originalMime: string | null, preview: boolean,
  fallbackBase: "document" | "receipt" | "attachment") {
  const converted = preview && (originalMime === "image/heic" || originalMime === "image/heif");
  const servedMime = converted ? "image/jpeg" : originalMime ?? "application/octet-stream";
  const displayName = converted
    ? originalName.replace(/\.(?:heic|heif)$/i, "") + ".jpg"
    : originalName;
  const safeName = displayName.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  const encodedName = encodeURIComponent(safeName).replace(/['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${preview ? "inline" : "attachment"}; filename="${fallbackBase}.${extensionByMime[servedMime] ?? "bin"}"; filename*=UTF-8''${encodedName}`;
}
