import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { sendMessageSchema, updateSettingsSchema } from "@workspace/db";
import { storage } from "../lib/ash/storage";
import { ashBridge } from "../lib/ash/bridge";

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
  res.json(state);
});

router.patch("/state", requireAuth, async (req, res): Promise<void> => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const state = await storage.updateState(parsed.data);
  res.json(state);
});

// ── Chat ──
router.get("/messages", requireAuth, async (_req, res): Promise<void> => {
  const messages = await storage.getMessages(300);
  res.json(messages);
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

  // Store Wicked's message (image kept for display only — one-and-done for the model).
  const wickedMessage = await storage.createMessage({
    role: "wicked",
    content: content.trim(),
    imageUrl: imageDataUrl || "",
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
  res.json({ wickedMessage, ashMessage });
});

// ── Diary ──
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

// ── Activity feed ──
router.get("/activity", requireAuth, async (_req, res): Promise<void> => {
  const events = await storage.getActivity(100);
  res.json(events);
});

// ── System info (Northflank panel) ──
router.get("/system", requireAuth, async (_req, res): Promise<void> => {
  const state = await storage.getState();
  const pingIntervalMs = await ashBridge.getEffectivePingIntervalMs();
  res.json({
    buildName: process.env["BUILD_NAME"] || "stillwater-dev",
    status: state.status,
    pingIntervalMs,
    pingIntervalOverrideMinutes: state.selfPromptIntervalOverride,
    selfPromptPaused: state.selfPromptPaused,
    apiKillSwitch: state.apiKillSwitch,
    lastHeartbeat: state.lastHeartbeat,
    tokensUsed: state.tokensUsed,
  });
});

export default router;
