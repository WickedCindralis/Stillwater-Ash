import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { storage } from "./storage";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 17 * 1024 * 1024;

type PendingCapture = {
  id: string;
  expiresAt: number;
  epoch: number;
  resolve: (imageDataUrl: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type FreshScreenCapture = {
  imageDataUrl: string;
  epoch: number;
};

let pendingCapture: PendingCapture | null = null;
let lastSeenWriteAt = 0;
let captureEpoch = 0;
let captureBlocked = false;

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

function clearPending(result: string | null, error = ""): void {
  const current = pendingCapture;
  if (!current) return;
  pendingCapture = null;
  clearTimeout(current.timer);
  current.resolve(result);
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
  cancelPendingScreenCapture();
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
  cancelPendingScreenCapture();
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

export function cancelPendingScreenCapture(): void {
  captureBlocked = true;
  captureEpoch += 1;
  clearPending(null);
}

export function resumeScreenCaptureRequests(): void {
  captureEpoch += 1;
  captureBlocked = false;
}

export function isFreshScreenCaptureCurrent(capture: FreshScreenCapture): boolean {
  return !captureBlocked && capture.epoch === captureEpoch;
}

export async function authenticateScreenCaptureToken(token: string): Promise<boolean> {
  const state = await storage.getState();
  return tokensMatch(token, state.screenCaptureTokenHash);
}

export async function getPendingCaptureRequest(token: string): Promise<{
  requestId: string;
  expiresAt: string;
} | null> {
  const state = await storage.getState();
  if (!tokensMatch(token, state.screenCaptureTokenHash)) return null;
  await touchLastSeen();

  if (state.screenCaptureEnabled !== 1) {
    cancelPendingScreenCapture();
    return null;
  }
  if (
    captureBlocked ||
    !pendingCapture ||
    pendingCapture.epoch !== captureEpoch ||
    pendingCapture.expiresAt <= Date.now()
  ) return null;
  return {
    requestId: pendingCapture.id,
    expiresAt: new Date(pendingCapture.expiresAt).toISOString(),
  };
}

export async function acceptCapture(
  token: string,
  requestId: string,
  imageDataUrl: unknown,
): Promise<{ accepted: boolean; error?: string }> {
  const state = await storage.getState();
  if (!tokensMatch(token, state.screenCaptureTokenHash)) {
    return { accepted: false, error: "Invalid companion token" };
  }
  if (state.screenCaptureEnabled !== 1) {
    cancelPendingScreenCapture();
    return { accepted: false, error: "Screenshots are turned off" };
  }
  if (
    captureBlocked ||
    !pendingCapture ||
    pendingCapture.epoch !== captureEpoch ||
    pendingCapture.id !== requestId
  ) {
    return { accepted: false, error: "Capture request is no longer pending" };
  }
  const acceptedPending = pendingCapture;
  if (acceptedPending.expiresAt <= Date.now()) {
    clearPending(null, "Capture request expired");
    return { accepted: false, error: "Capture request expired" };
  }

  const validated = validateImageDataUrl(imageDataUrl);
  if (!validated) {
    await storage.updateState({ screenCaptureLastError: "Rejected invalid or oversized image" });
    return { accepted: false, error: "Image must be a valid base64 JPEG, PNG, or WebP under 12MB" };
  }

  await storage.updateState({
    screenCaptureLastCaptureAt: new Date(),
    screenCaptureLastError: "",
    screenCaptureLastSeen: new Date(),
  });
  if (
    captureBlocked ||
    captureEpoch !== acceptedPending.epoch ||
    pendingCapture !== acceptedPending
  ) {
    return { accepted: false, error: "Capture request was invalidated before delivery" };
  }
  clearPending(validated);
  return { accepted: true };
}

export async function waitForFreshScreenCapture(): Promise<FreshScreenCapture | null> {
  const requestedAtEpoch = captureEpoch;
  const state = await storage.getState();
  if (captureBlocked || requestedAtEpoch !== captureEpoch) return null;
  if (state.screenCaptureEnabled !== 1 || !state.screenCaptureTokenHash) return null;
  if (pendingCapture) return null;

  const id = randomUUID();
  const expiresAt = Date.now() + REQUEST_TIMEOUT_MS;
  const imageDataUrl = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      if (pendingCapture?.id !== id) return;
      clearPending(null, "The Windows companion did not answer in time");
    }, REQUEST_TIMEOUT_MS);
    pendingCapture = { id, expiresAt, epoch: requestedAtEpoch, resolve, timer };
  });
  if (!imageDataUrl || captureBlocked || requestedAtEpoch !== captureEpoch) return null;
  return { imageDataUrl, epoch: requestedAtEpoch };
}

export function getScreenCaptureTimeoutMs(): number {
  return REQUEST_TIMEOUT_MS;
}