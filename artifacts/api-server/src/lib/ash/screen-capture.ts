import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { storage } from "./storage";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 17 * 1024 * 1024;

export type FreshScreenCapture = {
  imageDataUrl: string;
  epoch: number;
  activityId: number;
};

let lastSeenWriteAt = 0;
let captureEpoch = 0;
let captureCancellation = Promise.resolve();
let localPendingId = "";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokensMatch(provided: string, storedHash: string): boolean {
  if (!provided || !storedHash) return false;
  const providedHash = Buffer.from(hashToken(provided), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return providedHash.length === expectedHash.length && timingSafeEqual(providedHash, expectedHash);
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  return Math.floor((dataUrl.length - comma - 1) * 3 / 4);
}

function validateImageDataUrl(imageDataUrl: unknown): string | null {
  if (typeof imageDataUrl !== "string" || imageDataUrl.length > MAX_DATA_URL_CHARS) return null;
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(imageDataUrl)) return null;
  if (estimateDataUrlBytes(imageDataUrl) <= 0 || estimateDataUrlBytes(imageDataUrl) > MAX_IMAGE_BYTES) return null;
  return imageDataUrl;
}

function clearPending(result: { imageDataUrl: string; activityId: number } | null, error = ""): void {
  void result;
  if (error) {
    void storage.updateState({ screenCaptureLastError: error }).catch(() => {});
  }
}

async function touchLastSeen(): Promise<void> {
  if (Date.now() - lastSeenWriteAt < 30_000) return;
  lastSeenWriteAt = Date.now();
  await storage.updateState({ screenCaptureLastSeen: new Date() });
}

export async function pairScreenCapture(): Promise<{ token: string; companionId: string }> {
  await cancelPendingScreenCapture();
  const token = randomBytes(32).toString("base64url");
  const companionId = randomUUID();
  await storage.updateState({
    screenCaptureTokenHash: hashToken(token),
    screenCaptureTokenCreatedAt: new Date(),
    screenCaptureCompanionId: companionId,
    screenCaptureLastSeen: null,
    screenCaptureLastCaptureAt: null,
    screenCaptureLastError: "",
    screenCaptureEnabled: 0,
  });
  return { token, companionId };
}

export async function revokeScreenCapture(): Promise<void> {
  await cancelPendingScreenCapture();
  await storage.updateState({
    screenCaptureEnabled: 0,
    screenCaptureTokenHash: "",
    screenCaptureTokenCreatedAt: null,
    screenCaptureCompanionId: "",
    screenCaptureLastSeen: null,
    screenCaptureLastCaptureAt: null,
    screenCaptureLastError: "",
  });
}

export function cancelPendingScreenCapture(): Promise<void> {
  captureEpoch += 1;
  const requestId = localPendingId;
  localPendingId = "";
  const cancellation = captureCancellation.then(() => storage.cancelCaptureRequest(requestId || undefined));
  captureCancellation = cancellation.catch(() => {});
  return cancellation;
}

export function resumeScreenCaptureRequests(): void {
  captureEpoch += 1;
}

export function isFreshScreenCaptureCurrent(capture: FreshScreenCapture): boolean {
  return capture.epoch === captureEpoch;
}

export async function authenticateScreenCaptureToken(token: string): Promise<boolean> {
  const state = await storage.getState();
  return tokensMatch(token, state.screenCaptureTokenHash);
}

export async function getPendingCaptureRequest(token: string): Promise<{
  requestId: string;
  expiresAt: string;
  sessionId: string;
  correlationId: string;
} | null> {
  const state = await storage.getState();
  if (!tokensMatch(token, state.screenCaptureTokenHash)) return null;
  await touchLastSeen();

  if (state.screenCaptureEnabled !== 1) {
    await cancelPendingScreenCapture();
    return null;
  }
  const pendingCapture = await storage.getCaptureRequest();
  if (!pendingCapture || pendingCapture.status !== "pending" || pendingCapture.expiresAt.getTime() <= Date.now()) return null;
  return {
    requestId: pendingCapture.requestId,
    expiresAt: pendingCapture.expiresAt.toISOString(),
    sessionId: pendingCapture.sessionId,
    correlationId: pendingCapture.correlationId,
  };
}

export async function acceptCapture(
  token: string,
  requestId: string,
  imageDataUrl: unknown,
): Promise<{ accepted: boolean; error?: string; sessionId?: string; correlationId?: string }> {
  const state = await storage.getState();
  if (!tokensMatch(token, state.screenCaptureTokenHash)) {
    return { accepted: false, error: "Invalid companion token" };
  }
  if (state.screenCaptureEnabled !== 1) {
    await cancelPendingScreenCapture();
    return { accepted: false, error: "Screenshots are turned off" };
  }
  const captureRequest = await storage.getCaptureRequest();
  if (!captureRequest || captureRequest.status !== "pending" || captureRequest.requestId !== requestId) {
    return { accepted: false, error: "Capture request is no longer pending" };
  }
  const operation = { sessionId: captureRequest.sessionId, correlationId: captureRequest.correlationId };
  if (captureRequest.expiresAt.getTime() <= Date.now()) {
    await storage.cancelCaptureRequest();
    return { accepted: false, error: "Capture request expired", ...operation };
  }

  const validated = validateImageDataUrl(imageDataUrl);
  if (!validated) {
    await storage.updateState({ screenCaptureLastError: "Rejected invalid or oversized image" });
    return { accepted: false, error: "Image must be a valid base64 JPEG, PNG, or WebP under 12MB", ...operation };
  }

  await storage.updateState({
    screenCaptureLastCaptureAt: new Date(),
    screenCaptureLastError: "",
    screenCaptureLastSeen: new Date(),
  });
  const screenshotActivityId = await storage.stageScreenCapture(validated);
  if (!(await storage.completeCaptureRequest(requestId, validated, screenshotActivityId))) {
    await storage.discardScreenCapture(screenshotActivityId);
    return { accepted: false, error: "Capture request was invalidated before delivery", ...operation };
  }
  if (!(await storage.publishCaptureRequest(requestId, screenshotActivityId))) {
    return { accepted: false, error: "Capture request was invalidated before delivery", ...operation };
  }
  return { accepted: true, ...operation };
}

export async function waitForFreshScreenCapture(metadata: { sessionId?: string; correlationId?: string } = {}): Promise<FreshScreenCapture | null> {
  const requestedAtEpoch = captureEpoch;
  const state = await storage.getState();
  if (requestedAtEpoch !== captureEpoch) return null;
  if (state.screenCaptureEnabled !== 1 || !state.screenCaptureTokenHash) return null;

  const id = randomUUID();
  const expiresAt = Date.now() + REQUEST_TIMEOUT_MS;
  await captureCancellation;
  if (requestedAtEpoch !== captureEpoch) return null;
  if (!(await storage.reserveCaptureRequest(id, new Date(expiresAt), metadata.sessionId, metadata.correlationId))) return null;
  localPendingId = id;
  while (Date.now() < expiresAt && requestedAtEpoch === captureEpoch) {
    const pending = await storage.getCaptureRequest();
    if (!pending || pending.requestId !== id || pending.status === "cancelled") return null;
    if (pending.status === "complete" && pending.activityId && pending.imageDataUrl) {
      const capture = { imageDataUrl: pending.imageDataUrl, activityId: pending.activityId, epoch: requestedAtEpoch };
      if (requestedAtEpoch !== captureEpoch) return null;
      if (!(await storage.consumeCaptureRequest(id))) return null;
      if (localPendingId === id) localPendingId = "";
      if (requestedAtEpoch !== captureEpoch) return null;
      return capture;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await storage.cancelCaptureRequest(id);
  if (localPendingId === id) localPendingId = "";
  clearPending(null, "The Windows companion did not answer in time");
  return null;
}

export function getScreenCaptureTimeoutMs(): number {
  return REQUEST_TIMEOUT_MS;
}