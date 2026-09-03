import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { sendMessageSchema, updateSettingsSchema, updatePersonaSchema, updateHeraldCommentSchema, updateDiscordChannelsSchema, chessMoveSchema, connect4MoveSchema, type AshState } from "@workspace/db";
import { sweepTheWalls, manualSweepWaitMs } from "../lib/ash/herald";
import { SYSTEM_PROMPT, DEFAULT_SOUL_SHEET, DEFAULT_CORE_ANCHORS } from "../lib/ash/persona";
import { storage } from "../lib/ash/storage";
import { ashBridge } from "../lib/ash/bridge";
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
    cancelPendingScreenCapture();
  }
  const state = await storage.updateState(parsed.data);
  if (parsed.data.screenCaptureEnabled === 1) {
    resumeScreenCaptureRequests();
  }
  res.json(publicState(state));
});

// ── Desktop screen capture companion ──
router.post("/screen-capture/pair", requireAuth, async (_req, res): Promise<void> => {
  const pairing = await pairScreenCapture();
  res.json(pairing);
});

router.post("/screen-capture/revoke", requireAuth, async (_req, res): Promise<void> => {
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

router.get("/screen-capture/request", async (req, res): Promise<void> => {
  const token = companionToken(req);
  if (!(await authenticateScreenCaptureToken(token))) {
    res.status(401).json({ error: "Invalid companion token" });
    return;
  }
  const request = await getPendingCaptureRequest(token);
  res.json(request ? { requestId: request.requestId, expiresAt: request.expiresAt } : { requestId: null });
});

router.post("/screen-capture/request/:id", async (req, res): Promise<void> => {
  const token = companionToken(req);
  if (!(await authenticateScreenCaptureToken(token))) {
    res.status(401).json({ error: "Invalid companion token" });
    return;
  }
  const result = await acceptCapture(token, String(req.params.id), req.body?.imageDataUrl);
  if (!result.accepted) {
    res.status(409).json({ error: result.error || "Capture was not accepted" });
    return;
  }
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
  const before = Number(req.query["before"]);
  const beforeId = Number.isInteger(before) && before > 0 ? before : undefined;
  const messages = await storage.getMessages(300, beforeId);
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
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const { content, imageDataUrl, requestImage } = parsed.data;
  if (!content.trim() && !imageDataUrl) {
    res.status(400).json({ error: "Message is empty" });
    return;
  }
  if (imageDataUrl) {
    if (!imageDataUrl.startsWith("data:image/")) {
      res.status(400).json({ error: "Attachment must be an image" });
      return;
    }
    if (estimateDataUrlBytes(imageDataUrl) > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: "Image exceeds the 12MB limit" });
      return;
    }
  }

  // Store Wicked's message. Photos are one-and-done (Summer Palace rule):
  // Ash sees the image once in this exchange, but it is never persisted —
  // only the text stays in the chat history.
  const wickedMessage = await storage.createMessage({
    role: "wicked",
    content: content.trim(),
    imageUrl: "",
    source: "private_message",
  });

  const { text, imageUrl } = await ashBridge.handleWickedMessage(
    content.trim() || "(Wicked sent you a picture — look at it and respond.)",
    imageDataUrl,
    requestImage,
  );

  let ashMessage = null;
  if (text.trim() || imageUrl) {
    ashMessage = await storage.createMessage({
      role: "ash",
      content: text.trim(),
      imageUrl,
      source: "private_message",
    });
  }
  res.json({
    wickedMessage: lightweightMessage(wickedMessage),
    ashMessage: ashMessage ? lightweightMessage(ashMessage) : null,
  });
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
} as const;
type PersonaKey = keyof typeof PERSONA_DEFAULTS;
const PERSONA_COLUMNS: Record<PersonaKey, "personaIdentity" | "personaSoulSheet" | "personaCoreAnchors" | "personaAshNotes"> = {
  identity: "personaIdentity",
  soulSheet: "personaSoulSheet",
  coreAnchors: "personaCoreAnchors",
  ashNotes: "personaAshNotes",
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
