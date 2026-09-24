import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { sendMessageSchema, updateSettingsSchema, updatePersonaSchema, updateHeraldCommentSchema, updateDiscordChannelsSchema, chessMoveSchema, connect4MoveSchema, updateStorySchema, writeStorySchema, updateStoryChapterSchema, type AshState } from "@workspace/db";
import { sweepTheWalls, manualSweepWaitMs } from "../lib/ash/herald";
import { SYSTEM_PROMPT, DEFAULT_SOUL_SHEET, DEFAULT_CORE_ANCHORS } from "../lib/ash/persona";
import { storage } from "../lib/ash/storage";
import {
  authorizeHangoutCompanion,
  getHangoutScreenshot,
  hangoutStatus,
  invalidateHangoutForControl,
  pairHangoutCompanion,
  revokeHangoutCompanion,
  sendHangoutMessage,
  sendPrivateMessage,
  startHangout,
  stopHangout,
  syncHangoutCompanion,
} from "../lib/ash/hangout";
import { ashBridge, type AshPacketPreview } from "../lib/ash/bridge";
import { playWickedMove, startNewGame, resignGame, setGamePaused, ChessError } from "../lib/ash/chess";
import { playWickedDrop, startNewConnect4Game, resignConnect4Game, setConnect4Paused, Connect4Error } from "../lib/ash/connect4";
import { discordHerald } from "../lib/ash/discord";
import {
  acceptCapture,
  authenticateScreenCaptureToken,
  cancelPendingScreenCapture,
  getPendingCaptureRequest,
  pairScreenCapture,
  resumeScreenCaptureRequests,
  revokeScreenCapture,
} from "../lib/ash/screen-capture";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import path from "node:path";
import { randomUUID } from "node:crypto";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

const router: IRouter = Router();

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB decoded

function estimateDataUrlBytes(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}

function packetDocumentEscape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function packetDocumentText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function packetDocumentAccessDenied(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Ash Packet — Sign in required</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #080706; color: #e8dfcd; }
      body { min-height: 100vh; display: grid; place-items: center; margin: 0; }
      main { max-width: 34rem; margin: 1.5rem; padding: 2.5rem; border: 1px solid #8e742d; background: #15110d; text-align: center; }
      h1 { margin: 0 0 .75rem; color: #d7b65b; font: 600 2rem Georgia, serif; }
      p { color: #b8aa91; line-height: 1.6; }
      a { display: inline-block; margin-top: 1rem; color: #0d0b08; background: #d7b65b; padding: .7rem 1rem; text-decoration: none; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Ash API Packet</h1>
      <p>This private document requires an authenticated Stillwater session.</p>
      <a href="/login">Sign in to open the document</a>
    </main>
  </body>
</html>`;
}

function packetDocumentHtml(preview: AshPacketPreview): string {
  const rows: Array<[string, string]> = [
    ["Model", preview.request.model],
    ["Source", preview.source],
    ["Max completion tokens", String(preview.request.max_completion_tokens)],
    ["Provider storage", String(preview.request.store)],
    ["Request user", preview.request.user],
    ["Temperature", preview.request.temperature === undefined ? "not sent for this model" : String(preview.request.temperature)],
    ["Presence penalty", String(preview.request.presence_penalty)],
    ["Frequency penalty", String(preview.request.frequency_penalty)],
  ];
  const requestRows = rows
    .map(([label, value]) => `<div class="request-field"><dt>${packetDocumentEscape(label)}</dt><dd>${packetDocumentEscape(value)}</dd></div>`)
    .join("");
  const messages = preview.request.messages
    .map((message, index) => {
      const role = message.role.toUpperCase();
      const name = message.name ? ` / ${message.name}` : "";
      return `<section class="message">
  <header><span class="number">${String(index + 1).padStart(2, "0")}</span><span>${packetDocumentEscape(role)}</span><span class="name">${packetDocumentEscape(name)}</span></header>
  <pre>${packetDocumentEscape(packetDocumentText(message.content))}</pre>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <meta name="description" content="Private, live inspection document for Ash's complete API packet.">
    <title>Ash API Packet — Stillwater</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #080706; color: #211b16; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 2rem 1rem 4rem; background: #080706; }
      article { max-width: 72rem; margin: 0 auto; overflow: hidden; background: #e8dfcd; border: 1px solid #c6b99f; box-shadow: 0 20px 80px rgba(0,0,0,.45); }
      .masthead { padding: 2.5rem clamp(1.5rem, 5vw, 4rem); border-bottom: 1px solid rgba(143,128,104,.35); }
      .eyebrow, .section-label, dt { color: #78694f; font-size: .68rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
      h1 { margin: .45rem 0 0; color: #2e251b; font: 600 clamp(2.2rem, 5vw, 3.5rem)/1.05 Georgia, serif; }
      .intro { max-width: 48rem; margin: .8rem 0 0; color: #665946; font-size: .95rem; line-height: 1.65; }
      .stamp { float: right; margin: 0 0 1rem 2rem; padding: .8rem 1rem; border: 1px solid rgba(169,154,126,.55); background: rgba(242,234,220,.7); color: #756650; font: .72rem/1.6 ui-monospace, SFMono-Regular, monospace; text-align: right; }
      .stamp strong { display: block; color: #574a38; letter-spacing: .12em; text-transform: uppercase; }
      .content { display: grid; gap: 2rem; padding: 2.5rem clamp(1rem, 5vw, 4rem); }
      .panel { overflow: hidden; border: 1px solid rgba(183,169,143,.7); background: rgba(245,238,226,.8); }
      .panel-heading, .message header { padding: .85rem 1rem; border-bottom: 1px solid rgba(200,188,167,.7); background: rgba(222,210,189,.55); }
      .panel-note { margin: .35rem 0 0; color: #756650; font-size: .78rem; line-height: 1.55; }
      dl { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 1rem 1.5rem; margin: 0; padding: 1.2rem; }
      .request-field dd { margin: .35rem 0 0; overflow-wrap: anywhere; color: #2d261d; font: .8rem/1.45 ui-monospace, SFMono-Regular, monospace; }
      .input { padding: 1rem 1.2rem; border-top: 1px solid rgba(200,188,167,.7); }
      .input pre, .message pre { margin: .6rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #2d261d; font: .78rem/1.7 ui-monospace, SFMono-Regular, monospace; }
      .message { overflow: hidden; border: 1px solid rgba(183,169,143,.7); background: rgba(245,238,226,.8); }
      .message header { display: flex; flex-wrap: wrap; gap: .75rem; color: #6e604c; font-size: .68rem; font-weight: 700; letter-spacing: .14em; }
      .message .number { color: #9a7b36; }
      .message .name { color: #88785f; font-weight: 400; letter-spacing: .08em; }
      .message pre { margin: 0; padding: 1rem 1.2rem; }
      footer { padding: 1.25rem clamp(1.5rem, 5vw, 4rem); border-top: 1px solid rgba(143,128,104,.35); color: #756650; font-size: .78rem; line-height: 1.6; }
      @media (max-width: 680px) { body { padding: 0; } .stamp { float: none; margin: 0 0 1.25rem; text-align: left; } dl { grid-template-columns: 1fr; } }
      @media print { body { padding: 0; background: white; } article { border: 0; box-shadow: none; } .message, .panel { break-inside: avoid; } }
    </style>
  </head>
  <body>
    <article>
      <header class="masthead">
        <div class="stamp"><strong>${preview.request.messages.length} packet entries</strong>History: omitted<br>${packetDocumentEscape(preview.generatedAt)}</div>
        <div class="eyebrow">Stillwater / Internal Document</div>
        <h1>Ash Cindralis</h1>
        <p class="intro">The complete live request packet assembled immediately before a private-message API call. This document uses the database-backed persona and operational state, with conversation history intentionally omitted.</p>
      </header>
      <main class="content">
        <section class="panel">
          <div class="panel-heading">
            <div class="section-label">00 / OpenAI Request Envelope</div>
            <p class="panel-note">Request-level fields sent alongside the ordered message array. No API credential or response data is included.</p>
          </div>
          <dl>${requestRows}</dl>
          <div class="input"><div class="section-label">Preview input</div><pre>${packetDocumentEscape(preview.input)}</pre></div>
        </section>
        <div class="section-label">01 / Ordered Message Array — ${preview.request.messages.length} messages</div>
        ${messages}
      </main>
      <footer>This document is generated from the same packet assembly and request-parameter path used by Ash's private-message API calls. Conversation history, images, and Discord context are intentionally absent; live status and active game state are included when present. Reload to rebuild it from current state.</footer>
    </article>
  </body>
</html>`;
}

function publicState(
  state: AshState,
): Omit<AshState, "screenCaptureTokenHash" | "discordContinuitySummary"> {
  const {
    screenCaptureTokenHash: _tokenHash,
    discordContinuitySummary: _discordContinuitySummary,
    ...safeState
  } = state;
  return safeState;
}

function storyManuscript(story: Awaited<ReturnType<typeof storage.getStory>>): {
  id: string; title: string; storyPacket: string; summary: string; status: string;
  lastError: string | null; currentChapterId: number | null; updatedAt: Date;
} {
  const run = story.run;
  const status = story.story.runStatus === "complete" ? "idle"
    : story.story.runStatus === "paused" ? "incomplete"
      : story.story.runStatus === "failed" ? "error" : story.story.runStatus;
  return { id: "ash", title: story.story.title, storyPacket: story.story.storyPacket, summary: story.story.rollingSummary,
    status, lastError: run?.error || null, currentChapterId: run?.chapterId ?? null, updatedAt: story.story.updatedAt };
}

// ── Auth ──
router.post("/login", (req, res): void => {
  const { password } = req.body || {};
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured" });
    return;
  }
  if (typeof password === "string" && password === adminPassword) {
    req.session.authenticated = true;
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ error: "Wrong password" });
});

router.post("/logout", (req, res): void => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/auth/me", (req, res): void => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// ── State / settings ──
router.get("/state", requireAuth, async (_req, res): Promise<void> => {
  const state = await storage.getState();
  res.json(publicState(state));
});

router.patch("/state", requireAuth, async (req, res): Promise<void> => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  if (parsed.data.screenCaptureEnabled === 1) {
    const current = await storage.getState();
    if (!current.screenCaptureTokenHash) {
      res.status(409).json({ error: "Pair the Windows companion before turning screenshots on" });
      return;
    }
  } else if (parsed.data.screenCaptureEnabled === 0) {
    await invalidateHangoutForControl();
    await cancelPendingScreenCapture();
  }
  if (parsed.data.apiKillSwitch === 1) await invalidateHangoutForControl();
  const state = await storage.updateState(parsed.data);
  if (parsed.data.screenCaptureEnabled === 1) {
    resumeScreenCaptureRequests();
  }
  res.json(publicState(state));
});

// ── Desktop screen capture companion ──
router.post("/screen-capture/pair", requireAuth, async (_req, res): Promise<void> => {
  await invalidateHangoutForControl();
  const pairing = await pairScreenCapture();
  res.json(pairing);
});

router.post("/screen-capture/revoke", requireAuth, async (_req, res): Promise<void> => {
  await invalidateHangoutForControl();
  await revokeScreenCapture();
  res.json({ ok: true });
});

router.get("/screen-capture/companion", requireAuth, (_req, res): void => {
  const companionPath = path.resolve(
    __dirname,
    "../../../desktop-companion/release/Stillwater.Companion.exe",
  );
  res.download(companionPath, "Stillwater.Companion.exe", (error) => {
    if (error && !res.headersSent) {
      res.status(503).json({ error: "The Windows app package is not available yet" });
    }
  });
});

function companionToken(req: Request): string {
  const header = req.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function logHangoutHttp(req: Request, event: string, correlationId: string, startedAt: number, fields: Record<string, unknown> = {}): void {
  req.log?.info({ event, correlationId, durationMs: Date.now() - startedAt, ...fields }, "Hangout HTTP boundary");
}

function hangoutErrorStatus(error: unknown): 400 | 409 {
  const message = error instanceof Error ? error.message : "Hangout request failed";
  return /already in progress|already active|exchange is already|invitation is still/i.test(message) ? 409 : 400;
}

function hangoutError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Hangout request failed";
  const safeMessage = /^(Pair the Windows Hangout companion first|The Hangout companion must be connected before starting|Turn screenshot capture ON before starting a Hangout|Hangout is disabled by the API kill switch|A Hangout session is already in progress|A Hangout exchange is already in progress|Hangout invitation is still awaiting a clear approval decision\.|Hangout is not active)$/.test(message)
    ? message
    : "Hangout could not complete the request. Check session status and try again.";
  res.status(hangoutErrorStatus(error)).json({ error: safeMessage });
}

// ── Hangout web session controls ──
router.get("/hangout/status", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  try {
    const status = await hangoutStatus();
    logHangoutHttp(req, "success", correlationId, startedAt, { sessionId: status.sessionId });
    res.json(status);
  } catch (error) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500 });
    res.status(500).json({ error: "Could not read Hangout status" });
  }
});

router.post("/hangout/start", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  try {
    const result = await startHangout();
    logHangoutHttp(req, "success", correlationId, startedAt, { sessionId: result.sessionId, sessionStatus: result.status });
    res.json(result);
  } catch (error) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: hangoutErrorStatus(error) });
    hangoutError(res, error);
  }
});

router.post("/hangout/stop", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  try {
    await stopHangout();
    logHangoutHttp(req, "success", correlationId, startedAt);
    res.json(await hangoutStatus());
  } catch {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500 });
    res.status(500).json({ error: "Could not stop Hangout" });
  }
});

router.post("/hangout/companion/pair", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  try {
    const paired = await pairHangoutCompanion();
    logHangoutHttp(req, "success", correlationId, startedAt);
    res.json(paired);
  } catch {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500 });
    res.status(500).json({ error: "Could not pair the Hangout companion" });
  }
});

router.post("/hangout/companion/revoke", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  try {
    await revokeHangoutCompanion();
    logHangoutHttp(req, "success", correlationId, startedAt);
    res.json({ ok: true });
  } catch {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500 });
    res.status(500).json({ error: "Could not revoke Hangout companion" });
  }
});

// ── Narrowly scoped Hangout companion API ──
router.get("/hangout/companion/sync", async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  const token = companionToken(req);
  const after = Number(req.query["after"]);
  const afterId = Number.isInteger(after) && after >= 0 ? after : 0;
  logHangoutHttp(req, "start", correlationId, startedAt, { after: afterId });
  try {
    const result = await syncHangoutCompanion(token, afterId);
    logHangoutHttp(req, "success", correlationId, startedAt, { sessionId: result.sessionId, messageCount: result.messages.length });
    res.json(result);
  } catch {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 401 });
    res.status(401).json({ error: "Invalid Hangout companion token" });
  }
});

router.post("/hangout/companion/send", async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  const token = companionToken(req);
  logHangoutHttp(req, "start", correlationId, startedAt);
  if (!(await authorizeHangoutCompanion(token))) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 401 });
    res.status(401).json({ error: "Invalid Hangout companion token" });
    return;
  }
  const content = req.body?.content;
  if (typeof content !== "string" || !content.trim() || content.length > 4000) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 400 });
    res.status(400).json({ error: "Content must contain 1–4000 characters" });
    return;
  }
  try {
    const result = await sendHangoutMessage(content);
    logHangoutHttp(req, "success", correlationId, startedAt, { messageId: result.wickedMessage.id, ashMessageId: result.ashMessage.id });
    res.json({
      wickedMessage: lightweightMessage({ ...result.wickedMessage, imageUrl: "" }),
      ashMessage: lightweightMessage({ ...result.ashMessage, imageUrl: "", screenshotActivityId: result.screenshotActivityId }),
    });
  } catch (error) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: hangoutErrorStatus(error) });
    hangoutError(res, error);
  }
});

router.post("/hangout/companion/stop", async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  if (!(await authorizeHangoutCompanion(companionToken(req)))) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 401 });
    res.status(401).json({ error: "Invalid Hangout companion token" });
    return;
  }
  try {
    await stopHangout();
    logHangoutHttp(req, "success", correlationId, startedAt);
    res.json(await hangoutStatus());
  } catch {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500 });
    res.status(500).json({ error: "Could not stop Hangout" });
  }
});

router.get("/hangout/companion/screenshot/:activityId", async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  const token = companionToken(req);
  if (!(await authorizeHangoutCompanion(token))) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 401 });
    res.status(401).json({ error: "Invalid Hangout companion token" });
    return;
  }
  const id = Number(req.params["activityId"]);
  let capture: Awaited<ReturnType<typeof getHangoutScreenshot>>;
  try {
    capture = Number.isInteger(id) && id > 0 ? await getHangoutScreenshot(id, token) : null;
  } catch {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500, activityId: id });
    res.status(500).json({ error: "Could not load Hangout screenshot" });
    return;
  }
  if (!capture) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 404, activityId: id });
    res.status(404).json({ error: "Hangout screenshot not found" });
    return;
  }
  const match = capture.imageDataUrl.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
  if (!match) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 500, activityId: id });
    res.status(500).json({ error: "Stored screenshot is invalid" });
    return;
  }
  const bytes = Buffer.from(match[2]!, "base64");
  logHangoutHttp(req, "success", correlationId, startedAt, {
    activityId: id, imageBytes: bytes.byteLength, mime: match[1],
    sessionId: capture.sessionId, operationCorrelationId: capture.correlationId,
  });
  res.setHeader("Content-Type", match[1]!);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(bytes);
});

router.get("/screen-capture/request", async (req, res): Promise<void> => {
  const startedAt = Date.now(), correlationId = randomUUID();
  req.log?.info({ event: "start", correlationId }, "Screen-capture HTTP boundary");
  const token = companionToken(req);
  if (!(await authenticateScreenCaptureToken(token))) {
    req.log?.info({ event: "failure", correlationId, durationMs: Date.now() - startedAt, statusCode: 401 }, "Screen-capture HTTP boundary");
    res.status(401).json({ error: "Invalid companion token" });
    return;
  }
  const request = await getPendingCaptureRequest(token);
  req.log?.info({
    event: "success", correlationId, durationMs: Date.now() - startedAt, requestPending: !!request,
    sessionId: request?.sessionId, operationCorrelationId: request?.correlationId,
  }, "Screen-capture HTTP boundary");
  res.json(request ? { requestId: request.requestId, expiresAt: request.expiresAt } : { requestId: null });
});

router.post("/screen-capture/request/:id", async (req, res): Promise<void> => {
  const startedAt = Date.now(), correlationId = randomUUID();
  req.log?.info({ event: "start", correlationId }, "Screen-capture HTTP boundary");
  const token = companionToken(req);
  if (!(await authenticateScreenCaptureToken(token))) {
    req.log?.info({ event: "failure", correlationId, durationMs: Date.now() - startedAt, statusCode: 401 }, "Screen-capture HTTP boundary");
    res.status(401).json({ error: "Invalid companion token" });
    return;
  }
  const imageDataUrl = req.body?.imageDataUrl;
  const result = await acceptCapture(token, String(req.params.id), req.body?.imageDataUrl);
  if (!result.accepted) {
    req.log?.info({
      event: "failure", correlationId, durationMs: Date.now() - startedAt, statusCode: 409,
      sessionId: result.sessionId, operationCorrelationId: result.correlationId,
      imageBytes: typeof imageDataUrl === "string" ? estimateDataUrlBytes(imageDataUrl) : 0,
      mime: typeof imageDataUrl === "string" ? imageDataUrl.match(/^data:(image\/[\w.+-]+);/)?.[1] || "unknown" : "unknown",
    }, "Screen-capture HTTP boundary");
    res.status(409).json({ error: result.error || "Capture was not accepted" });
    return;
  }
  req.log?.info({
    event: "success", correlationId, durationMs: Date.now() - startedAt,
    imageBytes: typeof imageDataUrl === "string" ? estimateDataUrlBytes(imageDataUrl) : 0,
    mime: typeof imageDataUrl === "string" ? imageDataUrl.match(/^data:(image\/[\w.+-]+);/)?.[1] || "unknown" : "unknown",
    sessionId: result.sessionId, operationCorrelationId: result.correlationId,
  }, "Screen-capture HTTP boundary");
  res.json({ ok: true });
});

// ── Chat ──
// Inline base64 images are huge (several MB each); sending them inside the
// message list made the chat payload tens of MB and the chat could fail to
// load entirely. Replace them with a lightweight per-message image URL.
function lightweightMessage<T extends { id: number; imageUrl: string }>(m: T): T {
  if (m.imageUrl && m.imageUrl.startsWith("data:")) {
    return { ...m, imageUrl: `/api/messages/${m.id}/image` };
  }
  return m;
}

router.get("/messages", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  const before = Number(req.query["before"]);
  const beforeId = Number.isInteger(before) && before > 0 ? before : undefined;
  const messages = await storage.getMessages(300, beforeId);
  logHangoutHttp(req, "success", correlationId, startedAt, { messageCount: messages.length });
  res.json(messages.map(lightweightMessage));
});

router.get("/messages/:id/image", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const msg = Number.isInteger(id) ? await storage.getMessageById(id) : null;
  const match = msg?.imageUrl?.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
  if (!match) {
    res.status(404).json({ error: "No image on this message" });
    return;
  }
  const buf = Buffer.from(match[2]!, "base64");
  res.setHeader("Content-Type", match[1]!);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(buf);
});

router.post("/messages", requireAuth, async (req, res): Promise<void> => {
  const correlationId = randomUUID(), startedAt = Date.now();
  logHangoutHttp(req, "start", correlationId, startedAt);
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 400 });
    res
      .status(400)
      .json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const { content, imageDataUrl, requestImage } = parsed.data;
  if (!content.trim() && !imageDataUrl) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 400 });
    res.status(400).json({ error: "Message is empty" });
    return;
  }
  if (imageDataUrl) {
    if (!imageDataUrl.startsWith("data:image/")) {
      logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 400 });
      res.status(400).json({ error: "Attachment must be an image" });
      return;
    }
    if (estimateDataUrlBytes(imageDataUrl) > MAX_IMAGE_BYTES) {
      logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 400 });
      res.status(400).json({ error: "Image exceeds the 12MB limit" });
      return;
    }
  }

  try {
    const result = await sendPrivateMessage(content, imageDataUrl, requestImage);
    logHangoutHttp(req, "success", correlationId, startedAt, {
      messageId: result.wickedMessage.id, ashMessageId: result.ashMessage?.id ?? null,
    });
    res.json({
      wickedMessage: lightweightMessage(result.wickedMessage as typeof result.wickedMessage & { imageUrl: string }),
      ashMessage: result.ashMessage ? lightweightMessage(result.ashMessage) : null,
    });
  } catch (error) {
    logHangoutHttp(req, "failure", correlationId, startedAt, { statusCode: 409 });
    res.status(409).json({ error: error instanceof Error ? error.message : "Message could not be sent" });
  }
});

// ── Export & purge ──
const EASTERN_STAMP: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  month: "2-digit",
  day: "2-digit",
  year: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

router.get("/export-doc", requireAuth, async (_req, res): Promise<void> => {
  const [messages, diary] = await Promise.all([
    storage.getAllMessages(),
    storage.getDiaryEntries(),
  ]);

  type Entry = { kind: "message" | "diary"; who: string; content: string; at: Date };
  const entries: Entry[] = [
    ...messages.map((m): Entry => ({
      kind: "message",
      who: m.role === "wicked" ? "Wicked→Ash_Cindralis" : "Ash_Cindralis→Wicked",
      content: m.content,
      at: new Date(m.createdAt),
    })),
    ...diary.map((d): Entry => ({
      kind: "diary",
      who: "Ash's Diary",
      content: d.content,
      at: new Date(d.createdAt),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Stillwater Archive")] }),
    new Paragraph({
      children: [new TextRun({ text: `Exported ${new Date().toLocaleString("en-US", EASTERN_STAMP)} (Eastern) — ${messages.length} messages, ${diary.length} diary entries`, italics: true, color: "888888" })],
    }),
    new Paragraph({ children: [] }),
  ];
  for (const e of entries) {
    const stamp = e.at.toLocaleString("en-US", EASTERN_STAMP).replace(",", "");
    children.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [
          new TextRun({
            text: `${e.who} ${stamp}`,
            bold: true,
            color: e.kind === "diary" ? "B45309" : "8B7500",
          }),
        ],
      }),
    );
    for (const line of e.content.split("\n")) {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  res.setHeader("Content-Disposition", 'attachment; filename="stillwater-archive.docx"');
  res.send(buf);
});

router.post("/messages/purge", requireAuth, async (_req, res): Promise<void> => {
  const removed = await storage.purgeMessagesKeepLast(20);
  await storage.logActivity("status", `Chat purged — ${removed} messages removed, last 20 kept`);
  res.json({ removed });
});

// ── ElevenLabs TTS (streaming, Summer Palace pathing) ──
// Client POSTs { text }; the server looks up Ash's voice from ash_state and
// pipes the streaming MP3 straight through. The API key never leaves the server.
router.post("/tts", requireAuth, async (req, res): Promise<void> => {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing text" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "Text too long (max 5000 chars)" });
    return;
  }
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "ElevenLabs API key not configured" });
    return;
  }
  // Abort the upstream ElevenLabs request if the browser goes away so we
  // don't keep burning generation quota for nobody.
  const upstreamAbort = new AbortController();
  res.on("close", () => upstreamAbort.abort());
  try {
    const state = await storage.getState();
    const voiceId = state.voiceId;
    if (!voiceId) {
      res.status(400).json({ error: "No voice configured — set a voice ID in settings" });
      return;
    }
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=3&output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5",
          voice_settings: { stability: 0.4, similarity_boost: 0.75 },
        }),
        signal: upstreamAbort.signal,
      },
    );
    if (!response.ok || !response.body) {
      const err = response.body ? await response.text() : "no body";
      console.error("[tts] ElevenLabs error:", response.status, err.substring(0, 200));
      res.status(502).json({ error: `TTS failed: ${err.substring(0, 200)}` });
      return;
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    const { Readable } = await import("stream");
    const { pipeline } = await import("stream/promises");
    await pipeline(Readable.fromWeb(response.body as never), res);
  } catch (e) {
    if (upstreamAbort.signal.aborted) return; // client hung up — nothing to report
    console.error("[tts] Error:", e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.status(500).json({ error: "TTS request failed" });
    } else {
      res.end();
    }
  }
});

// ── Court Herald (TikTok comments, read-only) ──
router.get("/herald/comments", requireAuth, async (_req, res): Promise<void> => {
  const comments = await storage.listTiktokComments();
  const state = await storage.getState();
  res.json({
    comments,
    tiktokUsername: state.tiktokUsername,
    scraperConfigured: !!process.env["SCRAPECREATORS_API_KEY"],
  });
});

router.patch("/herald/comments/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Bad comment id" });
    return;
  }
  const parsed = updateHeraldCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const updated = await storage.updateTiktokComment(id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  res.json(updated);
});

router.post("/herald/refresh", requireAuth, async (_req, res): Promise<void> => {
  if (!process.env["SCRAPECREATORS_API_KEY"]) {
    res.status(503).json({ error: "Scraper API key not configured" });
    return;
  }
  const state = await storage.getState();
  if (!state.tiktokUsername.trim()) {
    res.status(400).json({ error: "No TikTok username set — give the Herald a name to watch" });
    return;
  }
  const waitMs = manualSweepWaitMs();
  if (waitMs > 0) {
    res.status(429).json({ error: `The Herald just swept — try again in ${Math.ceil(waitMs / 1000)}s` });
    return;
  }
  const added = await sweepTheWalls(true);
  res.json({ added });
});

// ── Discord Court Herald ──
router.get("/discord", requireAuth, async (_req, res): Promise<void> => {
  res.json(await discordHerald.getDashboardState());
});

router.put("/discord/channels", requireAuth, async (req, res): Promise<void> => {
  const parsed = updateDiscordChannelsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    });
    return;
  }
  try {
    await discordHerald.setPermittedChannels(parsed.data.channels);
    res.json(await discordHerald.getDashboardState());
  } catch (error) {
    req.log.warn({ err: error }, "Discord hall selection rejected");
    res.status(409).json({
      error: error instanceof Error ? error.message : "Discord halls could not be updated",
    });
  }
});

// ── Diary ──
// ── Persona packet editor ──
// Empty override in the DB = fall back to the built-in default in code.
const PERSONA_DEFAULTS = {
  identity: SYSTEM_PROMPT,
  soulSheet: DEFAULT_SOUL_SHEET,
  coreAnchors: DEFAULT_CORE_ANCHORS,
  ashNotes: "",
  storyPacket: "",
} as const;
type PersonaKey = keyof typeof PERSONA_DEFAULTS;
const PERSONA_COLUMNS: Record<PersonaKey, "personaIdentity" | "personaSoulSheet" | "personaCoreAnchors" | "personaAshNotes" | "personaStoryPacket"> = {
  identity: "personaIdentity",
  soulSheet: "personaSoulSheet",
  coreAnchors: "personaCoreAnchors",
  ashNotes: "personaAshNotes",
  storyPacket: "personaStoryPacket",
};

router.get("/persona", requireAuth, async (_req, res): Promise<void> => {
  const state = await storage.getState();
  const sections: Record<string, { value: string; default: string; edited: boolean }> = {};
  for (const key of Object.keys(PERSONA_DEFAULTS) as PersonaKey[]) {
    const override = (state[PERSONA_COLUMNS[key]] || "").trim();
    sections[key] = {
      value: override || PERSONA_DEFAULTS[key],
      default: PERSONA_DEFAULTS[key],
      edited: override.length > 0,
    };
  }
  res.json({ sections });
});

router.get("/packet-preview", requireAuth, async (_req, res): Promise<void> => {
  const preview = await ashBridge.buildPacketPreview();
  res.json(preview);
});

router.get("/packet-document", async (req, res): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).type("html").send(packetDocumentAccessDenied());
    return;
  }
  const preview = await ashBridge.buildPacketPreview();
  res
    .status(200)
    .type("html")
    .set("Cache-Control", "private, no-store")
    .set("Content-Disposition", 'inline; filename="ash-packet.html"')
    .send(packetDocumentHtml(preview));
});

router.post("/persona", requireAuth, async (req, res): Promise<void> => {
  const parsed = updatePersonaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid persona payload (a section may be too large)" });
    return;
  }
  const patch: Record<string, string> = {};
  const changed: string[] = [];
  for (const key of Object.keys(PERSONA_DEFAULTS) as PersonaKey[]) {
    const incoming = parsed.data[key];
    if (incoming === undefined) continue;
    // Saving text identical to the built-in default clears the override,
    // so the section reads as "original" again.
    const trimmed = incoming.trim();
    patch[PERSONA_COLUMNS[key]] = trimmed === PERSONA_DEFAULTS[key].trim() ? "" : incoming;
    changed.push(key);
  }
  if (changed.length > 0) {
    await storage.updateState(patch);
    if (parsed.data.storyPacket !== undefined) {
      await storage.updateStory({ storyPacket: parsed.data.storyPacket });
    }
    await storage.logActivity("persona", `Wicked edited Ash's persona packet (${changed.join(", ")})`).catch(() => {});
  }
  const state = await storage.getState();
  const sections: Record<string, { value: string; default: string; edited: boolean }> = {};
  for (const key of Object.keys(PERSONA_DEFAULTS) as PersonaKey[]) {
    const override = (state[PERSONA_COLUMNS[key]] || "").trim();
    sections[key] = {
      value: override || PERSONA_DEFAULTS[key],
      default: PERSONA_DEFAULTS[key],
      edited: override.length > 0,
    };
  }
  res.json({ sections, saved: changed });
});

router.get("/diary", requireAuth, async (_req, res): Promise<void> => {
  const entries = await storage.getDiaryEntries();
  res.json(entries);
});

router.delete("/diary/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params["id"])
    ? req.params["id"][0]
    : req.params["id"];
  const id = parseInt(String(raw), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await storage.deleteDiaryEntry(id);
  res.json({ ok: true });
});

// ── Story workspace ──
router.get("/story", requireAuth, async (_req, res): Promise<void> => {
  const story = await storage.getStory();
  res.json({ manuscript: storyManuscript(story), chapters: story.chapters });
});
router.patch("/story", requireAuth, async (req, res): Promise<void> => {
  const parsed = updateStorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") }); return; }
  const patch = { ...parsed.data, ...(parsed.data.summary === undefined ? {} : { rollingSummary: parsed.data.summary }) };
  delete (patch as Record<string, unknown>).summary;
  const updated = await storage.updateStoryWhenIdle(patch);
  if (!updated) { res.status(409).json({ error: "Manuscript settings cannot be edited while Ash is writing" }); return; }
  if (parsed.data.storyPacket !== undefined) await storage.updateState({ personaStoryPacket: parsed.data.storyPacket });
  res.json(storyManuscript(await storage.getStory()));
});
router.post("/story/write", requireAuth, async (req, res): Promise<void> => {
  const parsed = writeStorySchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") }); return; }
  const story = await storage.getStory();
  if (story.story.runStatus === "running") { res.status(409).json({ error: "A story run is already in progress" }); return; }
  if ((await storage.getState()).apiKillSwitch === 1) { res.status(503).json({ error: "Story writing is disabled by the API kill switch" }); return; }
  try {
    await ashBridge.startStoryWrite(parsed.data.prompt, parsed.data.resumeRunId);
    res.status(202).json(storyManuscript(await storage.getStory()));
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Story run failed" }); }
});
router.patch("/story/chapters/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id), parsed = updateStoryChapterSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) { res.status(400).json({ error: "Invalid chapter payload" }); return; }
  const story = await storage.getStory();
  if (story.story.runStatus === "running") {
    res.status(409).json({ error: "Chapters cannot be edited while Ash is writing" });
    return;
  }
  const chapter = await storage.updateStoryChapter(id, parsed.data);
  if (!chapter) { res.status(404).json({ error: "Chapter not found" }); return; }
  res.json(chapter);
});
router.delete("/story/chapters/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid chapter id" }); return; }
  const story = await storage.getStory();
  if (story.story.runStatus === "running") {
    res.status(409).json({ error: "Chapters cannot be deleted while Ash is writing" });
    return;
  }
  if (!(await storage.deleteStoryChapter(id))) {
    if ((await storage.getStory()).story.runStatus === "running") {
      res.status(409).json({ error: "Chapters cannot be deleted while Ash is writing" });
      return;
    }
    res.status(404).json({ error: "Chapter not found" });
    return;
  }
  res.json({ ok: true });
});
router.post("/story/chapters/:id/move", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id), direction = req.body?.direction;
  if (!Number.isInteger(id) || (direction !== "up" && direction !== "down")) { res.status(400).json({ error: "Invalid chapter direction" }); return; }
  if ((await storage.getStory()).story.runStatus === "running") {
    res.status(409).json({ error: "Chapters cannot be reordered while Ash is writing" });
    return;
  }
  const chapter = await storage.moveStoryChapterDirection(id, direction);
  if (!chapter) { res.status(404).json({ error: "Chapter not found" }); return; }
  res.json(chapter);
});
router.get("/story/packet-preview", requireAuth, async (_req, res): Promise<void> => {
  res.json(await ashBridge.buildStoryPacketPreview());
});
router.get("/story/packet-document", requireAuth, async (_req, res): Promise<void> => {
  const preview = await ashBridge.buildStoryPacketPreview();
  res.type("html").set("Cache-Control", "private, no-store").send(packetDocumentHtml(preview));
});
router.get("/story/export.txt", requireAuth, async (_req, res): Promise<void> => {
  const { story, chapters } = await storage.getStory();
  const text = [story.title, ...chapters.map((c) => `Chapter ${c.position}${c.title ? ` — ${c.title}` : ""}\n\n${c.content}${c.continuation ? `\n\n[Unfinished continuation]\n${c.continuation}` : ""}`)].filter(Boolean).join("\n\n");
  res.type("text/plain").set("Content-Disposition", 'attachment; filename="stillwater-story.txt"').send(text);
});
router.get("/story/export.docx", requireAuth, async (_req, res): Promise<void> => {
  const { story, chapters } = await storage.getStory();
  const children: Paragraph[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(story.title || "Stillwater Story")] })];
  for (const chapter of chapters) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Chapter ${chapter.position}${chapter.title ? ` — ${chapter.title}` : ""}`)] }));
    for (const line of chapter.content.split("\n")) children.push(new Paragraph({ children: [new TextRun(line)] }));
    if (chapter.continuation) children.push(new Paragraph({ children: [new TextRun({ text: `[Unfinished continuation]\n${chapter.continuation}`, italics: true })] }));
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", 'attachment; filename="stillwater-story.docx"');
  res.send(await Packer.toBuffer(new Document({ sections: [{ children }] })));
});

// ── Chess ──
router.get("/chess", requireAuth, async (_req, res): Promise<void> => {
  const game = await storage.getCurrentChessGame();
  res.json({ game });
});

router.post("/chess/new", requireAuth, async (_req, res): Promise<void> => {
  const game = await startNewGame();
  res.json({ game });
});

router.post("/chess/move", requireAuth, async (req, res): Promise<void> => {
  const parsed = chessMoveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  try {
    const result = await playWickedMove(parsed.data.san, parsed.data.message);
    res.json(result);
  } catch (e) {
    if (e instanceof ChessError) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.post("/chess/pause", requireAuth, async (req, res): Promise<void> => {
  try {
    const game = await setGamePaused(req.body?.paused !== false);
    res.json({ game });
  } catch (e) {
    if (e instanceof ChessError) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.post("/chess/resign", requireAuth, async (_req, res): Promise<void> => {
  try {
    const game = await resignGame();
    res.json({ game });
  } catch (e) {
    if (e instanceof ChessError) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw e;
  }
});

// ── Connect Four ──
router.get("/connect4", requireAuth, async (_req, res): Promise<void> => {
  const game = await storage.getCurrentConnect4Game();
  res.json({ game });
});

router.post("/connect4/new", requireAuth, async (_req, res): Promise<void> => {
  const game = await startNewConnect4Game();
  res.json({ game });
});

router.post("/connect4/move", requireAuth, async (req, res): Promise<void> => {
  const parsed = connect4MoveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  try {
    const result = await playWickedDrop(parsed.data.column, parsed.data.message);
    res.json(result);
  } catch (e) {
    if (e instanceof Connect4Error) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.post("/connect4/pause", requireAuth, async (req, res): Promise<void> => {
  try {
    const game = await setConnect4Paused(req.body?.paused !== false);
    res.json({ game });
  } catch (e) {
    if (e instanceof Connect4Error) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.post("/connect4/resign", requireAuth, async (_req, res): Promise<void> => {
  try {
    const game = await resignConnect4Game();
    res.json({ game });
  } catch (e) {
    if (e instanceof Connect4Error) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw e;
  }
});

// ── Activity feed ──
router.get("/activity", requireAuth, async (_req, res): Promise<void> => {
  const events = await storage.getActivity(100);
  res.json(events);
});

router.get("/activity/:id/screenshot", requireAuth, async (req, res): Promise<void> => {
  const rawActivityId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const activityId = Number.parseInt(rawActivityId ?? "", 10);
  if (!Number.isSafeInteger(activityId) || activityId <= 0) {
    res.status(400).json({ error: "Invalid activity id" });
    return;
  }
  const imageDataUrl = await storage.getActivityScreenshot(activityId);
  if (!imageDataUrl) {
    res.status(404).json({ error: "Screenshot not found" });
    return;
  }
  const match = imageDataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match) {
    res.status(500).json({ error: "Stored screenshot is invalid" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.type(`image/${match[1]}`);
  res.send(Buffer.from(match[2], "base64"));
});

// ── System info (Northflank panel) ──
router.get("/system", requireAuth, async (_req, res): Promise<void> => {
  const state = await storage.getState();
  const pingIntervalMs = await ashBridge.getEffectivePingIntervalMs();
  const heartbeatIntervalMs = await ashBridge.getEffectiveHeartbeatIntervalMs();
  res.json({
    buildName: process.env["BUILD_NAME"] || "stillwater-dev",
    status: state.status,
    pingIntervalMs,
    pingIntervalOverrideMinutes: state.selfPromptIntervalOverride,
    heartbeatIntervalMs,
    heartbeatIntervalOverrideMinutes: state.heartbeatIntervalOverride,
    selfPromptPaused: state.selfPromptPaused,
    apiKillSwitch: state.apiKillSwitch,
    discordKillSwitch: state.discordKillSwitch,
    lastHeartbeat: state.lastHeartbeat,
    tokensUsed: state.tokensUsed,
  });
});

export default router;
