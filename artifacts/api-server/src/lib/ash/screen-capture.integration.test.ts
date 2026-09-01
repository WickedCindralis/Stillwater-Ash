import assert from "node:assert/strict";
import test from "node:test";
import { storage } from "./storage";
import {
  acceptCapture,
  authenticateScreenCaptureToken,
  cancelPendingScreenCapture,
  getPendingCaptureRequest,
  isFreshScreenCaptureCurrent,
  pairScreenCapture,
  resumeScreenCaptureRequests,
  revokeScreenCapture,
  waitForFreshScreenCapture,
} from "./screen-capture";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function waitForPendingRequest(token: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const request = await getPendingCaptureRequest(token);
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return null;
}

test("screen capture pairing and one-shot delivery stay bounded", async () => {
  await revokeScreenCapture();
  try {
    const { token } = await pairScreenCapture();
    assert.equal(await authenticateScreenCaptureToken(token), true);
    assert.equal(await authenticateScreenCaptureToken("wrong-token"), false);

    assert.equal(await waitForFreshScreenCapture(), null, "toggle off must not create a request");
    await storage.updateState({ screenCaptureEnabled: 1 });
    resumeScreenCaptureRequests();

    const delivered = waitForFreshScreenCapture();
    const pending = await waitForPendingRequest(token);
    assert.ok(pending?.requestId);
    assert.equal(await getPendingCaptureRequest("wrong-token"), null);

    const invalid = await acceptCapture(token, pending.requestId, "not-an-image");
    assert.equal(invalid.accepted, false);

    const accepted = await acceptCapture(token, pending.requestId, ONE_PIXEL_PNG);
    assert.equal(accepted.accepted, true);
    const capture = await delivered;
    assert.equal(capture?.imageDataUrl, ONE_PIXEL_PNG);
    assert.equal(isFreshScreenCaptureCurrent(capture!), true);
    cancelPendingScreenCapture();
    assert.equal(
      isFreshScreenCaptureCurrent(capture!),
      false,
      "OFF after delivery must invalidate the image before provider submission",
    );

    const duplicate = await acceptCapture(token, pending.requestId, ONE_PIXEL_PNG);
    assert.equal(duplicate.accepted, false, "a request may be consumed only once");

    resumeScreenCaptureRequests();
    const cancelled = waitForFreshScreenCapture();
    cancelPendingScreenCapture();
    assert.equal(await cancelled, null, "turning screenshots off must release the waiting ping");
  } finally {
    await revokeScreenCapture();
  }
});

test("an in-flight old upload cannot resolve a request created after OFF then ON", async () => {
  await revokeScreenCapture();
  const originalUpdateState = storage.updateState.bind(storage);
  let releaseOldUpload!: () => void;
  let oldUploadReachedPersistence!: () => void;
  const oldUploadPaused = new Promise<void>((resolve) => {
    oldUploadReachedPersistence = resolve;
  });
  const releaseOldUploadPromise = new Promise<void>((resolve) => {
    releaseOldUpload = resolve;
  });

  try {
    const { token } = await pairScreenCapture();
    await originalUpdateState({ screenCaptureEnabled: 1 });
    resumeScreenCaptureRequests();

    const oldWaiter = waitForFreshScreenCapture();
    const oldRequest = await waitForPendingRequest(token);
    assert.ok(oldRequest?.requestId);

    (storage as any).updateState = async (updates: Record<string, unknown>) => {
      if (updates.screenCaptureLastCaptureAt) {
        oldUploadReachedPersistence();
        await releaseOldUploadPromise;
      }
      return originalUpdateState(updates);
    };
    const oldAccept = acceptCapture(token, oldRequest.requestId, ONE_PIXEL_PNG);
    await oldUploadPaused;

    cancelPendingScreenCapture();
    await originalUpdateState({ screenCaptureEnabled: 1 });
    resumeScreenCaptureRequests();
    const newWaiter = waitForFreshScreenCapture();
    const newRequest = await waitForPendingRequest(token);
    assert.ok(newRequest?.requestId);
    assert.notEqual(newRequest.requestId, oldRequest.requestId);

    releaseOldUpload();
    assert.equal((await oldAccept).accepted, false);
    assert.equal(await oldWaiter, null);

    const newAccepted = await acceptCapture(token, newRequest.requestId, ONE_PIXEL_PNG);
    assert.equal(newAccepted.accepted, true);
    assert.equal((await newWaiter)?.imageDataUrl, ONE_PIXEL_PNG);
  } finally {
    (storage as any).updateState = originalUpdateState;
    releaseOldUpload?.();
    await revokeScreenCapture();
  }
});