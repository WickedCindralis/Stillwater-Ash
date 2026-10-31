import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const client = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function storageLocation() {
  const dir = process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g, "");
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  const [bucket, ...prefix] = dir.split("/");
  if (!bucket) throw new Error("PRIVATE_OBJECT_DIR must include a bucket");
  return { bucket, prefix: prefix.join("/") };
}

export async function saveImageDataUrl(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/s);
  if (!match) throw new Error("Invalid image data");
  const { bucket, prefix } = storageLocation();
  const objectName = `${prefix ? `${prefix}/` : ""}uploads/${randomUUID()}`;
  await client.bucket(bucket).file(objectName).save(Buffer.from(match[2]!, "base64"), {
    resumable: false,
    metadata: { contentType: match[1], cacheControl: "private, max-age=31536000" },
  });
  return `/objects/${objectName.slice(prefix ? prefix.length + 1 : 0)}`;
}

export async function readImageDataUrl(objectPath: string): Promise<string> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid image object reference");
  const { bucket, prefix } = storageLocation();
  const objectName = `${prefix ? `${prefix}/` : ""}${objectPath.slice("/objects/".length)}`;
  const file = client.bucket(bucket).file(objectName);
  const [metadata] = await file.getMetadata();
  const [bytes] = await file.download();
  const mime = String(metadata.contentType || "image/png");
  if (!mime.startsWith("image/")) throw new Error("Stored object is not an image");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export async function readImageBytes(objectPath: string): Promise<{ bytes: Buffer; contentType: string }> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid image object reference");
  const { bucket, prefix } = storageLocation();
  const objectName = `${prefix ? `${prefix}/` : ""}${objectPath.slice("/objects/".length)}`;
  const file = client.bucket(bucket).file(objectName);
  const [metadata] = await file.getMetadata();
  const [bytes] = await file.download();
  const contentType = String(metadata.contentType || "image/png");
  if (!contentType.startsWith("image/")) throw new Error("Stored object is not an image");
  return { bytes, contentType };
}

export async function deleteImageObject(objectPath: string): Promise<void> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid image object reference");
  const { bucket, prefix } = storageLocation();
  const objectName = `${prefix ? `${prefix}/` : ""}${objectPath.slice("/objects/".length)}`;
  await client.bucket(bucket).file(objectName).delete({ ignoreNotFound: true });
}
