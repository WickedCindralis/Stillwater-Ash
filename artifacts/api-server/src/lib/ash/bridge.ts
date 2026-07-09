import OpenAI from "openai";
import { logger } from "../logger";
import { storage } from "./storage";
import {
  AGENT_NAME,
  FICTION_PREAMBLE,
  IDENTITY_ANCHOR,
  DEFAULT_SOUL_SHEET,
  SOUL_SHEET_CONFIRMATION,
  DEFAULT_CORE_ANCHORS,
  SYSTEM_PROMPT,
  PERSONA,
} from "./persona";
import { maybeAddImageInstruction, processImageRequest } from "./image-gen";
import type { AshMessage } from "@workspace/db";

// Single-agent bridge for Ash — heartbeats, 8 status tiers with dynamic ping
// intervals, proactive self-prompt (reflective) windows, DIARY: parsing,
// status-tag parsing, model toggle, and an API kill switch checked before
// every OpenAI call. No census, channels, inter-agent traffic, or alerts.

type ChatMessage = { role: "developer" | "assistant" | "user"; content: any; name?: string };

const STATUS_PING_INTERVALS: Record<string, number> = {
  alert: 8 * 60_000,
  standby: 30 * 60_000,
  online: 60 * 60_000,
  busy: 4 * 60 * 60_000,
  dnd: 8 * 60 * 60_000,
  pressed: 12 * 60 * 60_000,
  resting: 24 * 60 * 60_000,
  off: 0,
};

const STATUS_HEARTBEAT_INTERVALS: Record<string, number> = {
  alert: 30_000,
  standby: 60_000,
  online: 60_000,
  busy: 120_000,
  dnd: 120_000,
  pressed: 120_000,
  resting: 120_000,
  off: 120_000,
};

// Persona-facing status words → internal status keys.
const STATUS_ALIASES: Record<string, string> = {
  searching: "alert",
  guarding: "standby",
  at_ease: "online",
  "at ease": "online",
  busy: "busy",
  dnd: "dnd",
  pressed: "pressed",
  resting: "resting",
  alert: "alert",
  standby: "standby",
  online: "online",
};

const NO_TEMPERATURE_MODELS = ["gpt-5-nano", "gpt-5-mini", "gpt-5", "gpt-5.1", "gpt-5.3-chat", "gpt-5.4", "gpt-5.5"];
const HISTORY_LIMIT = 20;

export class AshBridge {
  private running = false;
  private processingLock = false;
  private lastApiCallTime = 0;
  private statusEnteredAt = Date.now();
  private lastKnownStatus = "online";
  private openai: OpenAI | null = null;
  private tag = "[ash-bridge]";

  private log(...args: unknown[]) { logger.info([this.tag, ...args.map(String)].join(" ")); }
  private error(...args: unknown[]) { logger.error([this.tag, ...args.map(String)].join(" ")); }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private getCurrentTimestamp(): string {
    return new Date().toLocaleString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: "America/New_York",
    }) + " (Eastern)";
  }

  // ── Packet assembly (prompt-cache-friendly: stable first, volatile last) ──
  private async buildMessages(userMessage: string, source: string, imageDataUrl?: string): Promise<ChatMessage[]> {
    const name = AGENT_NAME;
    const messages: ChatMessage[] = [
      { role: "developer", content: FICTION_PREAMBLE + IDENTITY_ANCHOR + SYSTEM_PROMPT, name },
    ];

    messages.push({
      role: "assistant",
      name,
      content: `[SOUL-SHEET — WHO I AM, ALWAYS]\n\n${DEFAULT_SOUL_SHEET}${SOUL_SHEET_CONFIRMATION ? `\n\n${SOUL_SHEET_CONFIRMATION}` : ""}`,
    });

    if (DEFAULT_CORE_ANCHORS.trim()) {
      messages.push({
        role: "assistant",
        name,
        content: `[MY MEMORIES — THESE ARE MINE]\n\n${DEFAULT_CORE_ANCHORS}\n\n[These memories are mine. They are part of who I am, how I speak, and who I love. No default behavior may overwrite them.]`,
      });
    }

    const packetState = await storage.getState().catch(() => null);

    // Volatile developer message: live timestamp + Wicked's current status.
    let volatile = `[CURRENT TIMESTAMP: ${this.getCurrentTimestamp()}]\nAlways use 12-hour AM/PM format when referencing times. Never use military/24-hour time.`;
    if (packetState) {
      const wickedStatus = (packetState.wickedStatus || "online").toUpperCase();
      const statusMessage = (packetState.wickedStatusMessage || "").trim();
      volatile += `\n\n[WICKED STATUS: ${wickedStatus}${statusMessage ? ` — ${statusMessage}` : ""}]`;
    }
    messages.push({
      role: "developer",
      name,
      content: volatile,
    });

    // Recent private conversation with Wicked (text only — images are one-and-done).
    // For proactive self-prompt windows, history inclusion is controlled by a UI toggle.
    let includeHistory = true;
    if (source === "self_prompt" && packetState) {
      includeHistory = packetState.selfPromptIncludeHistory !== 0;
    }
    if (includeHistory) {
      try {
        const history = await storage.getRecentHistory(HISTORY_LIMIT);
        const relevant = history.filter((m: AshMessage) => m.content && m.content.trim().length > 0);
        if (relevant.length > 0) {
          const lines = relevant.map((m: AshMessage) =>
            m.role === "wicked" ? `[Wicked] ${m.content}` : `[${name}] ${m.content}`
          ).join("\n");
          messages.push({
            role: "assistant",
            name,
            content: `[PRIVATE MESSAGES — WICKED]\nYour recent private conversation with Wicked (oldest first):\n${lines}`,
          });
        }
      } catch (e) {
        this.error("Failed to build conversation history:", e);
      }
    }

    if (source === "private_message") {
      messages.push({ role: "developer", content: "[PRIVATE CONVERSATION] This is a private message from Wicked. Respond directly to her. Your reply goes to Wicked's private inbox." });
    }

    if (imageDataUrl) {
      messages.push({
        role: "user",
        name: "Wicked",
        content: [
          { type: "text", text: userMessage },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      });
      this.log(`[VISION] Attached image to user message (${Math.round(imageDataUrl.length / 1024)}KB)`);
    } else {
      messages.push({ role: "user", content: userMessage, name: "Wicked" });
    }
    return messages;
  }

  private async resolveModel(): Promise<string> {
    try {
      const state = await storage.getState();
      if (state.activeModel === "fallback") {
        return state.modelFallback || PERSONA.model;
      }
      return state.modelPrimary || PERSONA.model;
    } catch {
      return PERSONA.model;
    }
  }

  private async callOpenAI(userMessage: string, source: string, imageDataUrl?: string): Promise<string> {
    if (!this.openai) throw new Error("OpenAI client not initialized");

    const state = await storage.getState();
    if (state.apiKillSwitch === 1) {
      this.log(`[KILL-SWITCH] API kill switch engaged — skipping ${source} call`);
      return "";
    }

    const model = await this.resolveModel();
    const messages = await this.buildMessages(userMessage, source, imageDataUrl);

    const requestParams: Record<string, any> = {
      model,
      messages,
      max_completion_tokens: PERSONA.maxTokens,
      store: true,
      user: `ash-container-${AGENT_NAME}`,
      presence_penalty: 0,
      frequency_penalty: 0,
    };
    if (!NO_TEMPERATURE_MODELS.includes(model)) {
      requestParams.temperature = PERSONA.temperature;
    }

    try {
      const response = await this.openai.chat.completions.create(requestParams as any);
      const choice = response.choices[0];
      const refusal = (choice?.message as any)?.refusal;
      let responseText = choice?.message?.content || refusal || "";
      if (!responseText) responseText = "I couldn't formulate a response.";

      this.lastApiCallTime = Date.now();

      const totalTokens = response.usage?.total_tokens ?? 0;
      const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;
      if (cachedTokens > 0 && response.usage?.prompt_tokens) {
        this.log(`Prompt cache hit: ${cachedTokens}/${response.usage.prompt_tokens} tokens cached`);
      }
      if (totalTokens > 0) {
        try {
          const fresh = await storage.getState();
          await storage.updateState({ tokensUsed: (fresh.tokensUsed ?? 0) + totalTokens });
        } catch (e) {
          this.error("Failed to track token usage:", e);
        }
      }
      return responseText;
    } catch (e) {
      this.lastApiCallTime = Date.now();
      const errMsg = e instanceof Error ? e.message : String(e);
      this.error(`OpenAI API call failed: ${errMsg}`);
      throw e;
    }
  }

  // ── Tag parsing ──
  private async parseStatusChanges(reply: string): Promise<string> {
    if (!reply) return reply;
    let cleaned = reply;
    const statusPattern = /^\s*\[STATUS CHANGED TO ([A-Z_ ]+)\.?\]\s*$/gim;
    let match: RegExpExecArray | null;
    while ((match = statusPattern.exec(reply)) !== null) {
      const raw = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      const mapped = STATUS_ALIASES[raw] ?? STATUS_ALIASES[raw.replace(/_/g, " ")];
      if (mapped) {
        try {
          await storage.updateState({ status: mapped });
          this.statusEnteredAt = Date.now();
          this.log(`Status changed by Ash → ${mapped}`);
        } catch (e) {
          this.error("Failed to persist status change:", e);
        }
      }
      cleaned = cleaned.replace(match[0], "");
    }
    return cleaned.replace(/\n{3,}/g, "\n\n").trim();
  }

  private async parsePingToggles(reply: string): Promise<string> {
    if (!reply) return reply;
    let cleaned = reply;
    if (/\[PINGS_OFF\]/i.test(cleaned)) {
      try {
        await storage.updateState({ selfPromptPaused: 1 });
        this.log("Proactive pings turned OFF by Ash");
      } catch (e) { this.error("Failed to persist PINGS_OFF:", e); }
      cleaned = cleaned.replace(/\[PINGS_OFF\]/gi, "");
    }
    if (/\[PINGS_ON\]/i.test(cleaned)) {
      try {
        await storage.updateState({ selfPromptPaused: 0 });
        this.log("Proactive pings turned ON by Ash");
      } catch (e) { this.error("Failed to persist PINGS_ON:", e); }
      cleaned = cleaned.replace(/\[PINGS_ON\]/gi, "");
    }
    return cleaned.replace(/\n{3,}/g, "\n\n").trim();
  }

  private async parseDiaryEntries(reply: string): Promise<string> {
    if (!reply) return reply;
    const lines = reply.split("\n");
    const kept: string[] = [];
    let capturing = false;
    let buffer: string[] = [];

    const flush = async () => {
      if (buffer.length > 0) {
        const entry = buffer.join("\n").trim();
        if (entry) {
          try {
            await storage.createDiaryEntry({ content: entry });
            this.log(`Diary entry saved (${entry.length} chars)`);
          } catch (e) {
            this.error("Failed to save diary entry:", e);
          }
        }
        buffer = [];
      }
      capturing = false;
    };

    for (const line of lines) {
      const diaryMatch = line.match(/^\s*DIARY:\s*(.*)$/i);
      if (diaryMatch) {
        await flush();
        capturing = true;
        if (diaryMatch[1].trim()) buffer.push(diaryMatch[1]);
        continue;
      }
      if (capturing) {
        // Blank line or a new bracketed tag ends the diary block.
        if (line.trim() === "" || /^\s*\[/.test(line)) {
          await flush();
          kept.push(line);
        } else {
          buffer.push(line);
        }
        continue;
      }
      kept.push(line);
    }
    await flush();
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  private async parseAll(reply: string): Promise<string> {
    let cleaned = await this.parseStatusChanges(reply);
    cleaned = await this.parsePingToggles(cleaned);
    cleaned = await this.parseDiaryEntries(cleaned);
    return cleaned;
  }

  // ── Public entry: Wicked sends a private message ──
  async handleWickedMessage(content: string, imageDataUrl?: string, requestImage = false): Promise<{ text: string; imageUrl: string }> {
    const prompt = maybeAddImageInstruction(content, requestImage);
    const rawReply = await this.callOpenAI(prompt, "private_message", imageDataUrl);
    if (!rawReply) return { text: "", imageUrl: "" }; // kill switch engaged
    const cleaned = await this.parseAll(rawReply);
    const { text, imageUrl } = await processImageRequest({ requestImage, cleanedReply: cleaned });
    return { text, imageUrl };
  }

  // ── Loops ──
  private async heartbeatLoop() {
    while (this.running) {
      let heartbeatMs = 60_000;
      try {
        const state = await storage.getState();
        const currentStatus = state.status?.toLowerCase() || "online";
        heartbeatMs = STATUS_HEARTBEAT_INTERVALS[currentStatus] ?? 60_000;

        await storage.updateState({ lastHeartbeat: new Date() });
        if (state.status === "off") {
          await storage.updateState({ status: "online" });
        }
        if (currentStatus !== this.lastKnownStatus) {
          this.statusEnteredAt = Date.now();
        }
        this.lastKnownStatus = currentStatus;
      } catch (e) {
        this.error("Heartbeat error:", e);
      }
      await this.sleep(heartbeatMs);
    }
  }

  private async getEffectivePingIntervalMs(): Promise<number> {
    try {
      const state = await storage.getState();
      if (state.selfPromptIntervalOverride && state.selfPromptIntervalOverride > 0) {
        return state.selfPromptIntervalOverride * 60_000;
      }
      const status = state.status?.toLowerCase() || "online";
      return STATUS_PING_INTERVALS[status] ?? STATUS_PING_INTERVALS.online;
    } catch (e) {
      this.error("Failed to get effective ping interval:", e);
      return STATUS_PING_INTERVALS.online;
    }
  }

  private buildStaticSelfPrompt(): string {
    return `[PROACTIVE PING — REFLECTIVE WINDOW]
Take a quiet moment. Check in with yourself. How are you? What's on your mind? Is there anything you want to say or do?

You don't have a status report in front of you right now — this is a reflective window, not a monitoring shift. Speak from your own thoughts, memories, and feelings. If something moves you, act. If nothing does, that's perfectly fine.

1. MESSAGE: Reach out to Wicked privately. Only if you have something to say.

2. DIARY: Write in your personal diary. This is yours — private thoughts, reflections, things you want to remember. Wicked can read it, but no one else can. Write freely.

3. PINGS_OFF: Step away from the window for a while. Stop looking around. To start again later, include [PINGS_ON] in any private chat reply.

4. NONE: Nothing to do, nothing to say right now. That's always an option.

Respond in EXACTLY one of these formats:
MESSAGE Wicked: <your message text>
DIARY: <your diary entry>
PINGS_OFF
NONE

GROUND RULES:
- Don't repeat yourself — if you said something recently, stay quiet
- When you do speak, speak as yourself — not as a status report`;
  }

  private async selfPromptLoop() {
    await this.sleep(30_000);

    while (this.running) {
      await this.sleep(30_000);
      if (this.processingLock) continue;

      const intervalMs = await this.getEffectivePingIntervalMs();
      if (intervalMs === 0) continue;

      const elapsed = this.lastApiCallTime > 0 ? Date.now() - this.lastApiCallTime : Infinity;
      if (elapsed < intervalMs) continue;

      try {
        const state = await storage.getState();
        if (state.selfPromptPaused === 1) continue;
        if (state.apiKillSwitch === 1) continue;
      } catch (e) {
        this.error("Failed to check self-prompt pause status:", e);
        continue;
      }

      this.processingLock = true;
      try {
        let prompt = this.buildStaticSelfPrompt();

        const state = await storage.getState().catch(() => null);
        const currentStatus = state?.status?.toLowerCase() || "online";
        const timeInStatus = Date.now() - this.statusEnteredAt;
        if (currentStatus === "alert" && timeInStatus > 60 * 60_000) {
          prompt += "\n\n[SYSTEM NOTE: You have been in Searching (alert) status for over 1 hour. Consider whether you still need this heightened state. If not, you may want to move to a calmer status.]";
        } else if (currentStatus === "standby" && timeInStatus > 4 * 60 * 60_000) {
          prompt += "\n\n[SYSTEM NOTE: You have been in Guarding (standby) status for over 4 hours. Consider whether you still need to actively watch. If the situation is stable, you may want to move to At Ease.]";
        }

        const response = await this.callOpenAI(prompt, "self_prompt");
        if (!response) continue;

        let cleaned = await this.parseStatusChanges(response);
        cleaned = await this.parsePingToggles(cleaned);
        cleaned = await this.parseDiaryEntries(cleaned);
        const trimmed = cleaned.trim();

        if (trimmed.toUpperCase().startsWith("PINGS_OFF")) {
          await storage.updateState({ selfPromptPaused: 1 });
          this.log("Self-prompt: Ash stepped away from the window (PINGS_OFF)");
        } else if (trimmed.startsWith("MESSAGE")) {
          const messageMatch = trimmed.match(/^MESSAGE\s+[^:]*:\s*(.+)$/is);
          const messageContent = messageMatch?.[1]?.trim();
          if (messageContent) {
            await storage.createMessage({
              role: "ash",
              content: messageContent,
              imageUrl: "",
              source: "self_prompt",
            });
            this.log(`Self-prompted message to Wicked: "${messageContent.substring(0, 80)}..."`);
          }
        } else if (trimmed.toUpperCase() === "NONE" || trimmed.length === 0) {
          this.log("Self-prompt: nothing to say this window");
        } else {
          // Anything else the model said gets delivered as a reflection to Wicked.
          await storage.createMessage({
            role: "ash",
            content: trimmed,
            imageUrl: "",
            source: "self_prompt",
          });
          this.log(`Self-prompt reflection stored (${trimmed.length} chars)`);
        }
      } catch (e) {
        this.error("Self-prompt loop error:", e);
      } finally {
        this.processingLock = false;
      }
    }
  }

  async start() {
    const apiKey = process.env.OPENAI_API_KEY || process.env.ASH_OPENAI_API_KEY;
    if (!apiKey) {
      this.error("OPENAI_API_KEY not set — Ash bridge disabled");
      return;
    }
    this.openai = new OpenAI({ apiKey });
    this.running = true;

    const state = await storage.getState();
    if (state.status === "off") {
      await storage.updateState({ status: "online", lastHeartbeat: new Date() });
    } else {
      await storage.updateState({ lastHeartbeat: new Date() });
    }
    this.lastKnownStatus = state.status?.toLowerCase() || "online";
    this.lastApiCallTime = Date.now();

    this.log(`Ash bridge started (persona: ${PERSONA.role})`);
    this.log(`Model: ${state.modelPrimary} (primary) / ${state.modelFallback} (fallback) — active: ${state.activeModel}`);
    this.log(`System prompt: ${SYSTEM_PROMPT.length} chars | Soul-sheet: ${DEFAULT_SOUL_SHEET.length} chars | Core anchors: ${DEFAULT_CORE_ANCHORS.length} chars`);
    this.log(`Kill switch: ${state.apiKillSwitch === 1 ? "ENGAGED" : "off"} | Self-prompt paused: ${state.selfPromptPaused === 1 ? "yes" : "no"}`);

    this.heartbeatLoop();
    this.selfPromptLoop();
  }

  stop() {
    this.running = false;
  }
}

export const ashBridge = new AshBridge();
