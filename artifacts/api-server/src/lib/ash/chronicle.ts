import type { InsertChronicle, AshChronicle } from "@workspace/db";
import { storage } from "./storage";
export { buildChronicleContext } from "./chronicle-format";
import { buildChronicleContext } from "./chronicle-format";

const INBOX_PATH = "/api/chronicle-inbox/stillwater";
const REQUEST_TIMEOUT_MS = 10_000;

type UpstreamChronicle = {
  id: string;
  content: string;
  metadata?: unknown;
};

function configured(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.BLACKTHORN_BASE_URL?.trim().replace(/\/+$/, "");
  const token = (
    process.env.STILLWATER_CHRONICLE_TOKEN ||
    process.env.BLACKTHORN_BEARER_TOKEN ||
    process.env.BLACKTHORN_API_TOKEN ||
    ""
  ).trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

function parseChronicles(payload: unknown): UpstreamChronicle[] {
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).chronicles ?? (payload as Record<string, unknown>).items)
      : null;
  if (!Array.isArray(values)) throw new Error("Blackthorn chronicle response is not an array");
  return values.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Blackthorn chronicle entry is malformed");
    const item = value as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : typeof item.chronicleId === "string" ? item.chronicleId : "";
    const content = typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : "";
    if (!id.trim() || !content.trim()) throw new Error("Blackthorn chronicle entry lacks id or content");
    return { id: id.trim(), content, metadata: item.metadata };
  });
}

async function request(url: string, token: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function receiveBlackthornChronicles(): Promise<AshChronicle[]> {
  const config = configured();
  if (!config) return [];
  const response = await request(`${config.baseUrl}${INBOX_PATH}`, config.token, { method: "GET" });
  if (!response.ok) throw new Error(`Blackthorn chronicle fetch failed (${response.status})`);
  const incoming = parseChronicles(await response.json());
  const saved: AshChronicle[] = [];
  for (const item of incoming) {
    const result = await storage.saveChronicle({
      chronicleId: item.id,
      content: item.content,
      source: "blackthorn_stillwater",
      sourceMetadata: item.metadata == null ? null : item.metadata,
      status: "received",
      lastError: "",
    } as InsertChronicle);
    saved.push(result.chronicle);
  }
  return saved;
}

export async function acknowledgeBlackthornChronicle(chronicle: AshChronicle): Promise<void> {
  const config = configured();
  if (!config) throw new Error("Blackthorn acknowledgement configuration is missing");
  const response = await request(
    `${config.baseUrl}${INBOX_PATH}/${encodeURIComponent(chronicle.chronicleId)}/ack`,
    config.token,
    { method: "POST", body: JSON.stringify({ chronicleId: chronicle.chronicleId }), headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok) throw new Error(`Blackthorn chronicle acknowledgement failed (${response.status})`);
  await storage.markChronicleAcknowledged(chronicle.chronicleId);
}