import { createHash, randomUUID } from "node:crypto";
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

export async function saveSongAudioFromUrl(urlText: string, jobId: string, clipId: string): Promise<{ objectPath: string; contentType: string }> {
  const url = new URL(urlText);
  if (url.protocol !== "https:" || url.hostname !== "files.aimusicapi.ai") {
    throw new Error("Song audio URL is not an approved provider URL");
  }
  const { bucket, prefix } = storageLocation();
  const hash = createHash("sha256").update(`${jobId}:${clipId}`).digest("hex");
  const objectName = `${prefix ? `${prefix}/` : ""}music/${hash}.mp3`;
  const file = client.bucket(bucket).file(objectName);
  const [exists] = await file.exists();
  if (exists) return { objectPath: `/objects/${objectName.slice(prefix ? prefix.length + 1 : 0)}`, contentType: "audio/mpeg" };

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download song audio (HTTP ${response.status})`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  if (!contentType.startsWith("audio/")) throw new Error("Provider returned a non-audio file");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error("Song audio size is invalid");
  await file.save(bytes, { resumable: false, metadata: { contentType, cacheControl: "private, max-age=31536000" } });
  return { objectPath: `/objects/${objectName.slice(prefix ? prefix.length + 1 : 0)}`, contentType };
}

export async function saveHeraldImageFromUrl(urlText: string, commentId: string): Promise<{ objectPath: string; contentType: string }> {
  const url = new URL(urlText);
  const host = url.hostname.toLowerCase();
  const allowed = ["tiktokcdn.com", "tiktokcdn-us.com", "ibytedtos.com", "byteoversea.com", "muscdn.com", "tiktokv.com"];
  if (url.protocol !== "https:" || !allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Herald image URL is not from an approved TikTok media host");
  }
  const { bucket, prefix } = storageLocation();
  const hash = createHash("sha256").update(commentId).digest("hex");
  const objectName = `${prefix ? `${prefix}/` : ""}herald/${hash}`;
  const file = client.bucket(bucket).file(objectName);
  const [exists] = await file.exists();
  if (exists) return { objectPath: `/objects/${objectName.slice(prefix ? prefix.length + 1 : 0)}`, contentType: "image/jpeg" };
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not download Herald image (HTTP ${response.status})`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("Provider returned a non-image file");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Herald image size is invalid");
  await file.save(bytes, { resumable: false, metadata: { contentType, cacheControl: "private, max-age=31536000" } });
  return { objectPath: `/objects/${objectName.slice(prefix ? prefix.length + 1 : 0)}`, contentType };
}

export async function readSongAudioObject(objectPath: string): Promise<{ bytes: Buffer; contentType: string }> {
  if (!objectPath.startsWith("/objects/music/")) throw new Error("Invalid song audio object reference");
  const { bucket, prefix } = storageLocation();
  const objectName = `${prefix ? `${prefix}/` : ""}${objectPath.slice("/objects/".length)}`;
  const file = client.bucket(bucket).file(objectName);
  const [metadata] = await file.getMetadata();
  const [bytes] = await file.download();
  const contentType = String(metadata.contentType || "audio/mpeg");
  if (!contentType.startsWith("audio/")) throw new Error("Stored object is not audio");
  return { bytes, contentType };
}
