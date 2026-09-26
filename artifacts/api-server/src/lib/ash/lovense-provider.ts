import type { KingsFingersCommand } from "./kings-fingers-command";

const ORIGIN = "https://api.lovense-api.com";

export class LovenseError extends Error {}

async function post(path: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new LovenseError(`Lovense returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new LovenseError("Lovense returned an invalid response");
  return data as Record<string, unknown>;
}

export async function createLovenseQr(uid: string, utoken: string, token: string, fetcher: typeof fetch = fetch): Promise<string> {
  const result = await post("/api/lan/getQrCode", { token, uid, uname: "Wicked", utoken, v: 2 }, fetcher);
  const qr = (result.data as Record<string, unknown> | undefined)?.qr;
  if (result.code !== 0 || typeof qr !== "string" || !qr.startsWith("https://")) {
    throw new LovenseError(`Lovense did not issue a pairing QR (code ${String(result.code ?? "unknown")})`);
  }
  const url = new URL(qr);
  if (!["lovense.com", "lovense-api.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new LovenseError("Lovense returned a QR from an unexpected domain");
  }
  return qr;
}

export async function sendLovenseCommand(
  uid: string, token: string, toyId: string, command: KingsFingersCommand, fetcher: typeof fetch = fetch,
): Promise<void> {
  const action = command.kind === "STOP" ? "Stop"
    : `${command.kind === "FINGER" ? "Fingering" : "Vibrate"}:${command.intensity}`;
  const result = await post("/api/lan/v2/command", {
    token, uid, toy: toyId, command: "Function", action, timeSec: command.kind === "STOP" ? 0 : command.seconds,
    stopPrevious: 1, apiVer: 1,
  }, fetcher);
  if (result.code !== 200 || result.result !== true) {
    throw new LovenseError(`Lovense rejected the device command (code ${String(result.code ?? "unknown")})`);
  }
}