import assert from "node:assert/strict";
import { checkDocumentFile, MAX_DOCUMENT_BYTES } from "../lib/document-files.ts";
import { canPreviewFile, fileContentDisposition } from "../lib/file-preview.ts";
import { uuidPattern } from "../lib/uuid.ts";
import { readBoundedFormData, UploadInputError } from "../lib/upload-request.ts";

assert(uuidPattern.test("00000000-0000-4000-8000-000000000001"));
assert(canPreviewFile("application/pdf") && canPreviewFile("image/jpeg") && canPreviewFile("image/png"));
assert(canPreviewFile("image/heic") && canPreviewFile("image/heif") && !canPreviewFile("text/html") && !canPreviewFile(null));
assert.equal(fileContentDisposition("Фото (1).HEIC", "image/heic", true, "document"),
  "inline; filename=\"document.jpg\"; filename*=UTF-8''%D0%A4%D0%BE%D1%82%D0%BE%20%281%29.jpg");
assert.equal(fileContentDisposition("Фото (1).HEIC", "image/heic", false, "document"),
  "attachment; filename=\"document.heic\"; filename*=UTF-8''%D0%A4%D0%BE%D1%82%D0%BE%20%281%29.HEIC");
assert.equal(fileContentDisposition("a'b.heif", "image/heif", true, "attachment"),
  "inline; filename=\"attachment.jpg\"; filename*=UTF-8''a%27b.jpg");
assert.equal(fileContentDisposition("scan.pdf", "application/pdf", false, "receipt"),
  "attachment; filename=\"receipt.pdf\"; filename*=UTF-8''scan.pdf");
assert(!uuidPattern.test("00000000-0000-4000-000000000001"));
const multipart = new FormData();
multipart.set("caseId", "00000000-0000-4000-8000-000000000001");
const parsedMultipart = await readBoundedFormData(new Request("http://localhost/upload", {
  method: "POST", body: multipart,
}), 1024);
assert.equal(parsedMultipart.get("caseId"), "00000000-0000-4000-8000-000000000001");
await assert.rejects(readBoundedFormData(new Request("http://localhost/upload", {
  method: "POST", body: new Uint8Array(32),
  headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "32" },
}), 16), (error) => error instanceof UploadInputError && error.status === 413);
await assert.rejects(readBoundedFormData(new Request("http://localhost/upload", {
  method: "POST", duplex: "half",
  headers: { "content-type": "multipart/form-data; boundary=test" },
  body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32)); controller.close(); } }),
}), 16), (error) => error instanceof UploadInputError && error.status === 413);

const pdf = new File([Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")], "paper.pdf", { type: "text/html" });
const checkedPdf = await checkDocumentFile(pdf);
assert.equal(checkedPdf.mime, "application/pdf");
assert.equal(checkedPdf.size, pdf.size);
assert.match(checkedPdf.sha256, /^[0-9a-f]{64}$/);

const pngChunk = (name, data) => {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  return Buffer.concat([size, Buffer.from(name), data, Buffer.alloc(4)]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
const png = new File([Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.from([0])), pngChunk("IEND", Buffer.alloc(0)),
])], "photo.png");
assert.equal((await checkDocumentFile(png)).mime, "image/png");
const jpeg = new File([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(28), Buffer.from([0xff, 0xd9])])], "photo.jpg");
assert.equal((await checkDocumentFile(jpeg)).mime, "image/jpeg");
const heicBytes = Buffer.alloc(32);
heicBytes.writeUInt32BE(24, 0);
heicBytes.write("ftypheic", 4, "ascii");
heicBytes.writeUInt32BE(8, 24);
heicBytes.write("mdat", 28, "ascii");
const heic = new File([heicBytes], "photo.heic");
assert.equal((await checkDocumentFile(heic)).mime, "image/heic");

for (const bad of [
  new File(["<html>"], "paper.pdf", { type: "application/pdf" }),
  new File(["%PDF-1.7"], "paper.exe"),
  new File(["%PDF-1.7\nbody without trailer"], "paper.pdf"),
  new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], "tiny.jpg"),
  new File([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], "tiny.png"),
  new File([Buffer.from("\0\0\0\0ftypheic\0\0\0\0")], "tiny.heic"),
  new File(["%PDF-1.7"], "../paper.pdf"),
  new File([Buffer.alloc(MAX_DOCUMENT_BYTES + 1)], "oversized.pdf"),
]) {
  await assert.rejects(checkDocumentFile(bad));
}
console.log("OK file signatures, extension matching, preview MIME policy, path names and size limit");
