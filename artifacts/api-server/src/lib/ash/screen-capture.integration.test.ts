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

    const activityBeforeInvalid = new Set((await storage.getActivity(100)).map((event) => event.id));
    const invalid = await acceptCapture(token, pending.requestId, "not-an-image");
    assert.equal(invalid.accepted, false);
    assert.equal(
      (await storage.getActivity(100)).some(
        (event) => !activityBeforeInvalid.has(event.id) && event.kind === "screen_capture",
      ),
      false,
      "invalid images must not create screenshot activity",
    );

    const accepted = await acceptCapture(token, pending.requestId, ONE_PIXEL_PNG);
    assert.equal(accepted.accepted, true);
    const activityAfterAccepted = await storage.getActivity(100);
    const screenshotActivity = activityAfterAccepted.find(
        (event) => !activityBeforeInvalid.has(event.id) &&
          event.kind === "screen_capture" &&
          event.message === "Screenshot taken",
    );
    assert.ok(screenshotActivity, "accepted screenshots must create a screenshot activity");
    assert.equal(screenshotActivity.hasScreenshot, true);
    assert.equal(
      await storage.getActivityScreenshot(screenshotActivity.id),
      ONE_PIXEL_PNG,
      "accepted screenshots must persist their image data",
    );
    const capture = await delivered;
    assert.equal(capture?.imageDataUrl, ONE_PIXEL_PNG);
    assert.equal(isFreshScreenCaptureCurrent(capture!), true);
    await cancelPendingScreenCapture();
    assert.equal(
      isFreshScreenCaptureCurrent(capture!),
      false,
      "OFF after delivery must invalidate the image before provider submission",
    );

    const duplicate = await acceptCapture(token, pending.requestId, ONE_PIXEL_PNG);
    assert.equal(duplicate.accepted, false, "a request may be consumed only once");

    resumeScreenCaptureRequests();
    const cancelled = waitForFreshScreenCapture();
    await cancelPendingScreenCapture();
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

    await cancelPendingScreenCapture();
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

test("cancelling while screenshot persistence is in flight leaves no stored image", async () => {
  await revokeScreenCapture();
  const originalStageScreenCapture = storage.stageScreenCapture.bind(storage);
  let releasePersistence!: () => void;
  let persistenceCommitted!: () => void;
  const persistenceCommittedPromise = new Promise<void>((resolve) => {
    persistenceCommitted = resolve;
  });
  const releasePersistencePromise = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });

  try {
    const { token } = await pairScreenCapture();
    await storage.updateState({ screenCaptureEnabled: 1 });
    resumeScreenCaptureRequests();
    const activityBefore = new Set((await storage.getActivity(100)).map((event) => event.id));

    const delivered = waitForFreshScreenCapture();
    const pending = await waitForPendingRequest(token);
    assert.ok(pending?.requestId);

    (storage as any).stageScreenCapture = async (imageDataUrl: string) => {
      const activityId = await originalStageScreenCapture(imageDataUrl);
      persistenceCommitted();
      await releasePersistencePromise;
      return activityId;
    };
    const acceptance = acceptCapture(token, pending.requestId, ONE_PIXEL_PNG);
    await persistenceCommittedPromise;

    await cancelPendingScreenCapture();
    releasePersistence();

    assert.equal((await acceptance).accepted, false);
    assert.equal(await delivered, null);
    assert.equal(
      (await storage.getActivity(100)).some(
        (event) => !activityBefore.has(event.id) && event.kind === "screen_capture",
      ),
      false,
      "invalidated staged screenshots must be removed from activity and storage",
    );
  } finally {
    (storage as any).stageScreenCapture = originalStageScreenCapture;
    releasePersistence?.();
    await revokeScreenCapture();
  }
});

test("cancellation after completion but before publish deletes staged screenshot atomically", async () => {
  await revokeScreenCapture();
  const originalGetCaptureRequest = storage.getCaptureRequest.bind(storage);
  const originalPublish = storage.publishCaptureRequest.bind(storage);
  let releaseCompleteRead!: () => void;
  let releasePublish!: () => void;
  let completeReadPaused!: () => void;
  let publishPaused!: () => void;
  const completeReadHeld = new Promise<void>((resolve) => { releaseCompleteRead = resolve; });
  const publishHeld = new Promise<void>((resolve) => { releasePublish = resolve; });
  const completeReadReached = new Promise<void>((resolve) => { completeReadPaused = resolve; });
  const publishReached = new Promise<void>((resolve) => { publishPaused = resolve; });

  try {
    const { token } = await pairScreenCapture();
    await storage.updateState({ screenCaptureEnabled: 1 });
    resumeScreenCaptureRequests();
    const activityBefore = new Set((await storage.getActivity(100)).map((event) => event.id));
    const delivered = waitForFreshScreenCapture();
    const pending = await waitForPendingRequest(token);
    assert.ok(pending?.requestId);

    (storage as any).getCaptureRequest = async () => {
      const request = await originalGetCaptureRequest();
      if (request?.status === "complete") {
        completeReadPaused();
        await completeReadHeld;
      }
      return request;
    };
    (storage as any).publishCaptureRequest = async (requestId: string, activityId: number) => {
      publishPaused();
      await publishHeld;
      return originalPublish(requestId, activityId);
    };

    const acceptance = acceptCapture(token, pending.requestId, ONE_PIXEL_PNG);
    await Promise.all([completeReadReached, publishReached]);
    await cancelPendingScreenCapture();
    releaseCompleteRead();
    releasePublish();

    assert.equal((await acceptance).accepted, false, "cancellation must win against a completed but unpublished upload");
    assert.equal(await delivered, null, "a cancelled completed request must not reach its waiter");
    assert.equal(
      (await storage.getActivity(100)).some((event) => !activityBefore.has(event.id) && event.kind === "screen_capture"),
      false,
      "cancellation must remove the staged activity and screenshot bytes",
    );
  } finally {
    (storage as any).getCaptureRequest = originalGetCaptureRequest;
    (storage as any).publishCaptureRequest = originalPublish;
    releaseCompleteRead?.();
    releasePublish?.();
    await revokeScreenCapture();
  }
});