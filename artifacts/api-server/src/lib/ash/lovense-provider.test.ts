import assert from "node:assert/strict";
import test from "node:test";
import { createLovenseQr, LovenseError, sendLovenseCommand } from "./lovense-provider";

function mockPost(path: string, expectedBody: Record<string, unknown>, result: unknown): typeof fetch {
  return (async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), `https://api.lovense-api.com${path}`);
    assert.equal(options?.method, "POST");
    assert.deepEqual(JSON.parse(String(options?.body)), expectedBody);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("pairing QR uses a per-pair UID and verification token without returning the token", async () => {
  const qr = "https://test2.lovense.com/UploadFiles/qr/a.jpg";
  assert.equal(await createLovenseQr("wicked_123", "random-otk", "developer-token", mockPost(
    "/api/lan/getQrCode",
    { token: "developer-token", uid: "wicked_123", uname: "Wicked", utoken: "random-otk", v: 2 },
    { code: 0, data: { qr } },
  )), qr);
  await assert.rejects(createLovenseQr("wicked_123", "random-otk", "developer-token", mockPost(
    "/api/lan/getQrCode",
    { token: "developer-token", uid: "wicked_123", uname: "Wicked", utoken: "random-otk", v: 2 },
    { code: 0, data: { qr: "https://evil.example/qr.png" } },
  )), LovenseError);
});

test("private device commands map to documented Lovense Function actions", async () => {
  for (const [command, action, seconds] of [
    [{ kind: "VIBRATE", intensity: 10, seconds: 5 }, "Vibrate:10", 5],
    [{ kind: "FINGER", intensity: 10, seconds: 5 }, "Fingering:10", 5],
    [{ kind: "STOP" }, "Stop", 0],
  ] as const) {
    await sendLovenseCommand("wicked_123", "developer-token", "toy_1", command, mockPost(
      "/api/lan/v2/command",
      { token: "developer-token", uid: "wicked_123", toy: "toy_1", command: "Function", action, timeSec: seconds, stopPrevious: 1, apiVer: 1 },
      { result: true, code: 200, message: "Success" },
    ));
  }
});

test("an offline or rejected device command is not reported as success", async () => {
  await assert.rejects(sendLovenseCommand("wicked_123", "developer-token", "toy_1", { kind: "STOP" }, mockPost(
    "/api/lan/v2/command",
    { token: "developer-token", uid: "wicked_123", toy: "toy_1", command: "Function", action: "Stop", timeSec: 0, stopPrevious: 1, apiVer: 1 },
    { result: false, code: 507, message: "APP is offline" },
  )), /code 507/);
});