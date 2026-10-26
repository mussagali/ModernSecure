import "server-only";

export async function previewFile(bytes: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string }> {
  if (mime !== "image/heic" && mime !== "image/heif") return { bytes, mime };

  const [{ default: decode }, { default: sharp }] = await Promise.all([
    import("heic-decode"), import("sharp"),
  ]);
  const images = await decode.all({ buffer: bytes });
  try {
    const first = images[0];
    if (!first || !Number.isSafeInteger(first.width) || !Number.isSafeInteger(first.height)
      || first.width < 1 || first.height < 1 || first.width * first.height > 40_000_000) {
      throw new Error("Preview image is too large or invalid");
    }
    const image = await first.decode();
    const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const jpeg = await sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } })
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: jpeg, mime: "image/jpeg" };
  } finally {
    images.dispose();
  }
}
