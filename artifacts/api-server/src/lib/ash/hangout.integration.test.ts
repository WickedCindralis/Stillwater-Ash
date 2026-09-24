import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { eq, gt } from "drizzle-orm";
import {
  ashActivity,
  ashCaptureRequest,
  ashHangoutSession,
  ashMessages,
  db,
} from "@workspace/db";
import router from "../../routes/ash";
import { ashBridge } from "./bridge";
import { storage } from "./storage";
import {
  authorizeHangoutCompanion,
  invalidateHangoutForControl,
  pairHangoutCompanion,
  revokeHangoutCompanion,
  sendHangoutMessage,
  startHangout,
  stopHangout,
  syncHangoutCompanion,
} from "./hangout";
import {
  acceptCapture,
  getPendingCaptureRequest,
  pairScreenCapture,
  revokeScreenCapture,
  resumeScreenCaptureRequests,
} from "./screen-capture";

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const INVITATION_REPLY = "Yes, I would like to hang out.";

async function waitForPendingCapture(token: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const request = await getPendingCaptureRequest(token);
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Expected a pending capture request");
}

async function fulfillNextCapture(token: string): Promise<void> {
  const request = await waitForPendingCapture(token);
  const result = await acceptCapture(token, request.requestId, ONE_PIXEL_PNG);
  assert.equal(result.accepted, true, "test screenshot should be accepted");
}

async function preparePairing() {
  const screen = await pairScreenCapture();
  await storage.updateState({ screenCaptureEnabled: 1, apiKillSwitch: 0 });
  resumeScreenCaptureRequests();
  const hangout = await pairHangoutCompanion();
  await syncHangoutCompanion(hangout.token, 0);
  return { screenToken: screen.token, hangoutToken: hangout.token };
}

async function prepareActiveSession() {
  const pairing = await preparePairing();
  const session = await storage.beginHangoutSession(
    `hangout-test-${Date.now()}-${Math.random()}`,
    new Date(Date.now() - 60_000),
  );
  assert.ok(session, "connected paired companion should start a session");
  const lease = await storage.acquireHangoutLease(session.sessionId);
  assert.ok(lease, "test session should acquire its exchange lease");
  assert.equal(await storage.setHangoutStatus(session.sessionId, session.generation, "active"), true);
  await storage.releaseHangoutLease(lease.token, lease.generation);
  return pairing;
}

async function startRouterServer(authenticateWeb = false) {
  const app = express();
  app.use(express.json());
  if (authenticateWeb) {
    app.use((request: any, _response: any, next: () => void) => {
      request.session = { authenticated: true };
      next();
    });
  }
  app.use("/api", router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    base: `http://127.0.0.1:${address.port}/api`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("Hangout DB integration: session lifecycle, shared messages, fencing, and auth", async (t) => {
  const originalState = await storage.getState();
  const originalSession = await storage.getHangoutSession();
  const originalCaptureRequest = await storage.getCaptureRequest();
  const originalMessages = await storage.getAllMessages();
  const firstTestMessageId = originalMessages.reduce((max, message) => Math.max(max, message.id), 0);
  const originalActivities = await db.select({ id: ashActivity.id }).from(ashActivity);
  const firstTestActivityId = originalActivities.reduce((max, activity) => Math.max(max, activity.id), 0);
  const originalApproval = ashBridge.requestHangoutApproval;
  const originalHangoutReply = ashBridge.replyToHangout;
  const originalReplyProcessor = ashBridge.processHangoutReply;
  let providerCalls = 0;

  const installNoProvider = (approval: string, reply: string) => {
    (ashBridge as any).requestHangoutApproval = async (
      _invitation: string,
      _correlationId: string,
      beforeProviderCall: () => Promise<boolean>,
    ) => {
      providerCalls += 1;
      assert.equal(await beforeProviderCall(), true, "approval provider must be fenced before invocation");
      return approval;
    };
    (ashBridge as any).replyToHangout = async (
      _prompt: string,
      capture: { imageDataUrl: string },
      _correlationId: string,
      beforeProviderCall: () => Promise<boolean>,
    ) => {
      providerCalls += 1;
      assert.equal(capture.imageDataUrl, ONE_PIXEL_PNG, "only the accepted fresh image reaches the fake provider");
      assert.equal(await beforeProviderCall(), true, "image provider must be fenced before invocation");
      return reply;
    };
    (ashBridge as any).processHangoutReply = async (content: string) => content;
  };

  try {
    await t.test("approval persists the machine decision and reply; decline persists without capture", async () => {
      let pairing = await preparePairing();
      installNoProvider('{"decision":"approve","reply":"Yes, I would like to hang out."}', "Welcome, Wicked.");
      const approvedStart = startHangout();
      await fulfillNextCapture(pairing.screenToken);
      const approved = await approvedStart;
      assert.equal(approved.status, "active");
      const approvalMessages = (await storage.getAllMessages()).filter((message) => message.content === INVITATION_REPLY);
      assert.ok(approvalMessages.length > 0, "approval reply should be in canonical history");
      assert.ok((await storage.getAllMessages()).some((message) => message.content === "Welcome, Wicked."));
      await stopHangout();

      pairing = await preparePairing();
      installNoProvider('{"decision":"decline","reply":"Not right now."}', "This must not run.");
      const declined = await startHangout();
      assert.equal(declined.status, "idle");
      const messagesAfterDecline = await storage.getAllMessages();
      assert.ok(messagesAfterDecline.some((message) => message.content === "Not right now."));
      assert.equal(providerCalls, 3, "decline must not start a screenshot-backed provider call");

      pairing = await preparePairing();
      void pairing;
      const rawInvalidOutput = "unstructured output with private provider details";
      installNoProvider(rawInvalidOutput, "This must not run either.");
      const malformed = await startHangout();
      assert.equal(malformed.status, "idle");
      const persisted = await storage.getAllMessages();
      assert.equal(persisted.some((message) => message.content === rawInvalidOutput), false);
      assert.ok(persisted.some((message) => message.content.includes("couldn't get a clear yes or no")));
      assert.equal(providerCalls, 4, "malformed approval must not invoke the image provider");
    });

    await t.test("web and companion messages share canonical history and screenshot mappings", async () => {
      const pairing = await prepareActiveSession();
      installNoProvider('{"decision":"decline","reply":"Unused."}', "A screenshot-backed reply.");
      const api = await startRouterServer(true);
      try {
        const webResponsePromise = fetch(`${api.base}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "web path integration marker" }),
        });
        await fulfillNextCapture(pairing.screenToken);
        const webResponse = await webResponsePromise;
        assert.equal(webResponse.status, 200, "web chat endpoint should use the active Hangout exchange");
        const webMessage = await webResponse.json() as { wickedMessage: { id: number }; ashMessage: { id: number } };

        const companionResponsePromise = fetch(`${api.base}/hangout/companion/send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${pairing.hangoutToken}`,
          },
          body: JSON.stringify({ content: "companion path integration marker" }),
        });
        await fulfillNextCapture(pairing.screenToken);
        const companionResponse = await companionResponsePromise;
        assert.equal(companionResponse.status, 200, "companion endpoint should use the same active Hangout exchange");
        const companionMessage = await companionResponse.json() as {
          wickedMessage: { id: number };
          ashMessage: { id: number; screenshotActivityId: number };
        };

        const synced = await syncHangoutCompanion(pairing.hangoutToken, 0);
        const ids = new Set(synced.messages.map((message) => message.id));
        assert.ok(ids.has(webMessage.wickedMessage.id));
        assert.ok(ids.has(webMessage.ashMessage.id));
        assert.ok(ids.has(companionMessage.wickedMessage.id));
        assert.ok(ids.has(companionMessage.ashMessage.id));
        assert.ok(synced.messages.find((message) => message.id === webMessage.ashMessage.id)?.screenshotActivityId);
        assert.ok(synced.messages.find((message) => message.id === companionMessage.ashMessage.id)?.screenshotActivityId);
      } finally {
        await api.close();
        await stopHangout();
      }
    });

    await t.test("idle claims are atomic and sync does not await idle capture/provider work", async () => {
      const pairing = await prepareActiveSession();
      await db.update(ashHangoutSession).set({
        lastActivityAt: new Date(Date.now() - 16 * 60_000),
        lastIdleCheckinAt: null,
        leaseToken: "",
        leaseExpiresAt: null,
      }).where(eq(ashHangoutSession.id, "ash"));
      const startedAt = Date.now();
      await syncHangoutCompanion(pairing.hangoutToken, 0);
      assert.ok(Date.now() - startedAt < 1_000, "sync should not wait for screenshot/provider idle work");

      const session = await storage.getHangoutSession();
      const cutoff = new Date(Date.now() - 15 * 60_000);
      const claims = await Promise.all([
        storage.acquireHangoutLease(session.sessionId, cutoff),
        storage.acquireHangoutLease(session.sessionId, cutoff),
      ]);
      assert.equal(claims.filter(Boolean).length, 1, "concurrent idle ticks must yield exactly one durable claim");
      const claim = claims.find(Boolean)!;
      await storage.releaseHangoutLease(claim.token, claim.generation);
    });

    await t.test("stop, OFF, and revoke fence pending sends before provider invocation", async () => {
      installNoProvider('{"decision":"approve","reply":"Unused."}', "must not reach this provider");
      const cases: Array<{ name: string; invalidate: (token: string) => Promise<void> }> = [
        { name: "stop", invalidate: async () => stopHangout() },
        {
          name: "OFF",
          invalidate: async () => {
            await invalidateHangoutForControl();
            await storage.updateState({ screenCaptureEnabled: 0, screenCaptureTokenHash: "" });
          },
        },
        { name: "revoke", invalidate: async () => revokeHangoutCompanion() },
      ];
      for (const scenario of cases) {
        const pairing = await prepareActiveSession();
        const beforeProviderCalls = providerCalls;
        const pendingSend = sendHangoutMessage(`${scenario.name} fence integration marker`).then(
          () => null,
          (error: unknown) => error,
        );
        await waitForPendingCapture(pairing.screenToken);
        await scenario.invalidate(pairing.hangoutToken);
        const result = await pendingSend;
        assert.ok(result instanceof Error, `${scenario.name} should reject the pending exchange`);
        assert.equal(providerCalls, beforeProviderCalls, `${scenario.name} must prevent the provider call`);
        if (scenario.name === "revoke") {
          assert.equal(await authorizeHangoutCompanion(pairing.hangoutToken), false, "revoked bearer must no longer authorize");
        }
      }
    });

    await t.test("companion bearer credentials are isolated from screen-capture credentials", async () => {
      const pairing = await preparePairing();
      const api = await startRouterServer();
      try {
        const missing = await fetch(`${api.base}/hangout/companion/sync`);
        assert.equal(missing.status, 401);
        const wrong = await fetch(`${api.base}/hangout/companion/sync`, {
          headers: { authorization: "Bearer wrong-test-token" },
        });
        assert.equal(wrong.status, 401);

        const validHangout = await fetch(`${api.base}/hangout/companion/sync`, {
          headers: { authorization: `Bearer ${pairing.hangoutToken}` },
        });
        assert.equal(validHangout.status, 200);

        const screenTokenAsHangout = await fetch(`${api.base}/hangout/companion/sync`, {
          headers: { authorization: `Bearer ${pairing.screenToken}` },
        });
        assert.equal(screenTokenAsHangout.status, 401);
        const hangoutTokenAsScreen = await fetch(`${api.base}/screen-capture/request`, {
          headers: { authorization: `Bearer ${pairing.hangoutToken}` },
        });
        assert.equal(hangoutTokenAsScreen.status, 401);
        const validScreen = await fetch(`${api.base}/screen-capture/request`, {
          headers: { authorization: `Bearer ${pairing.screenToken}` },
        });
        assert.equal(validScreen.status, 200);
      } finally {
        await api.close();
      }
    });
  } finally {
    (ashBridge as any).requestHangoutApproval = originalApproval;
    (ashBridge as any).replyToHangout = originalHangoutReply;
    (ashBridge as any).processHangoutReply = originalReplyProcessor;
    await stopHangout().catch(() => {});
    await revokeHangoutCompanion().catch(() => {});
    await revokeScreenCapture().catch(() => {});
    const newMessages = await db.select({ id: ashMessages.id }).from(ashMessages)
      .where(gt(ashMessages.id, firstTestMessageId));
    if (newMessages.length) await db.delete(ashMessages).where(gt(ashMessages.id, firstTestMessageId));
    const newActivities = await db.select({ id: ashActivity.id }).from(ashActivity)
      .where(gt(ashActivity.id, firstTestActivityId));
    for (const activity of newActivities) await storage.discardScreenCapture(activity.id);
    const { id: _stateId, ...state } = originalState;
    await storage.updateState(state);
    const { id: _sessionId, ...session } = originalSession;
    await db.update(ashHangoutSession).set(session).where(eq(ashHangoutSession.id, "ash"));
    await db.update(ashCaptureRequest).set({
      requestId: originalCaptureRequest?.requestId ?? "",
      sessionId: originalCaptureRequest?.sessionId ?? "",
      correlationId: originalCaptureRequest?.correlationId ?? "",
      status: originalCaptureRequest?.status ?? "idle",
      expiresAt: originalCaptureRequest?.expiresAt ?? null,
      imageDataUrl: originalCaptureRequest?.imageDataUrl ?? "",
      activityId: originalCaptureRequest?.activityId ?? null,
      updatedAt: new Date(),
    }).where(eq(ashCaptureRequest.id, "ash"));
    resumeScreenCaptureRequests();
  }
});